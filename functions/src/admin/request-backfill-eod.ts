// functions/src/admin/request-backfill-eod.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { PubSub } from "@google-cloud/pubsub";

import { normalizeList } from "../lib/symbols/normalize";
import { buildDefaultCloseProviders } from "../lib/close/priority";
import { coversDate } from "../lib/close/capabilities";
import { MAX_SYMBOLS_PER_BACKFILL_REQUEST } from "../config/limits";

// 单例初始化（幂等）
if (!admin.apps.length) {
  admin.initializeApp();
}

const pubsub = new PubSub();

// YYYY-MM-DD 基础校验
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 纽约口径“今天”（用于未来日校验与 provider 覆盖判断）
function nyTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export const requestBackfillEod = onCall(
  {
    region: "us-central1",
    maxInstances: 2,
    // 如需开启 App Check 可加：enforceAppCheck: true
  },
  async (request) => {
    const { auth, data } = request;
    const date = (data?.date ?? "") as string;
    const symbols = (data?.symbols ?? []) as unknown[];

    // 1) Admin 权限
    const isAdmin = auth?.token?.admin === true;
    if (!isAdmin) {
      throw new HttpsError("permission-denied", "Caller is not an admin.");
    }

    // 2) 输入校验（严格纽约日历，不允许请求未来日）
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      throw new HttpsError("invalid-argument", 'Date must be "YYYY-MM-DD".');
    }
    const todayNy = nyTodayYmd();
    if (date > todayNy) {
      throw new HttpsError(
        "invalid-argument",
        `Date ${date} is in the future (NY). Today is ${todayNy}.`
      );
    }
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new HttpsError("invalid-argument", "Symbols must be a non-empty array.");
    }

    // 3) 供应商覆盖校验（仍以 NY 当天为参照）
    const providers = buildDefaultCloseProviders();
    const isCovered = providers.some((p) => coversDate(p.name, date, todayNy));
    if (!isCovered) {
      throw new HttpsError(
        "failed-precondition",
        `No provider covers the requested date ${date}.`
      );
    }

    // 4) 归一化 + 上限（与前端保持一致的上限）
    let normalized: ReturnType<typeof normalizeList>;
    try {
      normalized = normalizeList(symbols, { maxSingle: MAX_SYMBOLS_PER_BACKFILL_REQUEST });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("exceeds the maximum size")) {
        throw new HttpsError(
          "resource-exhausted",
          `Too many symbols. Max ${MAX_SYMBOLS_PER_BACKFILL_REQUEST}.`
        );
      }
      throw new HttpsError("invalid-argument", msg);
    }

    // 去重后再做一次硬截断，保证绝对不超限
    const uniqueSymbols = Array.from(new Set(normalized.valid)).slice(
      0,
      MAX_SYMBOLS_PER_BACKFILL_REQUEST
    );

    if (uniqueSymbols.length === 0) {
      return {
        queuedCount: 0,
        alreadyQueued: [],
        alreadyDone: [],
        invalid: normalized.invalid,
        accepted: 0,
        maxPerCall: MAX_SYMBOLS_PER_BACKFILL_REQUEST,
      };
    }

    const db = getFirestore();
    const alreadyDone: string[] = [];
    const alreadyQueued: string[] = [];
    const toQueue: string[] = [];

    const backfillRequestsRef = db.collection("meta/backfillRequests");
    const officialClosesRef = db.collection("officialCloses");

    // 5) 幂等：如果已有 officialCloses 文档视为已完成；如已有 backfillRequests 视为已入队
    for (const symbol of uniqueSymbols) {
      const id = `${date}_${symbol}`;
      const closeDoc = await officialClosesRef.doc(id).get();
      if (closeDoc.exists) {
        alreadyDone.push(id);
        continue;
      }
      const requestDoc = await backfillRequestsRef.doc(id).get();
      if (requestDoc.exists) {
        alreadyQueued.push(id);
      } else {
        toQueue.push(symbol);
      }
    }

    // 6) 写入队列集合（batch）
    if (toQueue.length > 0) {
      const writeBatch = db.batch();
      const now = admin.firestore.Timestamp.now();
      for (const symbol of toQueue) {
        const id = `${date}_${symbol}`;
        writeBatch.set(backfillRequestsRef.doc(id), {
          status: "queued",
          createdAt: now,
          requestedBy: auth?.uid ?? null,
          date,
          symbol,
        });
      }
      await writeBatch.commit();

      // 7) Pub/Sub 发布（重试 1 次）
      let lastError: Error | undefined;
      for (let i = 0; i < 2; i++) {
        try {
          await pubsub.topic("backfill-eod").publishMessage({
            json: { date, symbols: toQueue },
          });
          lastError = undefined;
          break;
        } catch (e: any) {
          lastError = e;
          if (i === 0) {
            await new Promise((r) => setTimeout(r, 300)); // backoff
          }
        }
      }

      if (lastError) {
        logger.warn("Failed to publish backfill-eod message after 2 attempts", {
          date,
          count: toQueue.length,
          error: String(lastError?.message ?? lastError),
        });
        // 保持与原有行为一致：抛出错误由前端/调用方处理
        throw new HttpsError("internal", "Pub/Sub publish failed");
      }
    }

    // 8) 返回摘要
    return {
      queuedCount: toQueue.length,
      alreadyQueued,
      alreadyDone,
      invalid: normalized.invalid,
      accepted: uniqueSymbols.length,
      maxPerCall: MAX_SYMBOLS_PER_BACKFILL_REQUEST,
    };
  }
);
