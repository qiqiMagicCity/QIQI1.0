// functions/src/admin/request-backfill-eod.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2"; // 结构化日志（Structured Logging）
import { PubSub } from "@google-cloud/pubsub";  // Pub/Sub（发布/订阅）
import { normalizeList } from "../lib/symbols/normalize";
import { MAX_SYMBOLS_PER_BACKFILL_REQUEST } from "../config/limits";

// —— Firebase Admin（管理端 SDK）幂等初始化
if (!admin.apps.length) {
  admin.initializeApp();
}

// —— 懒加载 Pub/Sub（发布订阅）客户端
let _pubsub: PubSub | null = null;
function getPubSub(): PubSub {
  return _pubsub ?? (_pubsub = new PubSub());
}

// —— YYYY-MM-DD 基础校验
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// —— 纽约口径“今天”（用于禁止未来日）
function nyTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

export const requestBackfillEod = onCall(
  {
    region: "us-central1",
    maxInstances: 2,
    // 如需强制 App Check（应用校验 App Check），可启用：
    // enforceAppCheck: true,
  },
  async (request) => {
    const { auth, data } = request;

    // 1) 权限：要求已登录（Auth 认证）
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }

    // 2) 入参解析与校验（注意：onCall 的请求体外层必须是 data，JSON（杰森）格式）
    const date = String(data?.date ?? "").trim();
    const rawSymbols = (data?.symbols ?? []) as unknown[];

    if (!DATE_RE.test(date)) {
      throw new HttpsError("invalid-argument", 'Date must be "YYYY-MM-DD".');
    }
    const todayNy = nyTodayYmd();
    if (date > todayNy) {
      throw new HttpsError(
        "invalid-argument",
        `Date ${date} is in the future (NY). Today is ${todayNy}.`
      );
    }

    const symbolsArr: string[] = Array.isArray(rawSymbols)
      ? rawSymbols.map((s) => String(s))
      : [];
    if (symbolsArr.length === 0) {
      throw new HttpsError("invalid-argument", "Symbols must be a non-empty array.");
    }

    // 3) 归一化 + 去重 + 上限（Limits）
    let normalized: ReturnType<typeof normalizeList>;
    try {
      normalized = normalizeList(symbolsArr, {
        maxSingle: MAX_SYMBOLS_PER_BACKFILL_REQUEST,
      });
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

    const uniqueSymbols = Array.from(new Set(normalized.valid)).slice(
      0,
      MAX_SYMBOLS_PER_BACKFILL_REQUEST
    );

    if (uniqueSymbols.length === 0) {
      logger.info("[requestBackfillEod] nothing-to-queue", { date });
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

    // 4) 幂等检查（Idempotency）
    // 固定路径：meta/backfill/requests
    const backfillRequestsRef = db
      .collection("meta")
      .doc("backfill")
      .collection("requests");
    const officialClosesRef = db.collection("officialCloses");

    for (const symbol of uniqueSymbols) {
      const id = `${date}_${symbol}`;

      // 已有官方收盘价 → 视为已完成
      const closeDoc = await officialClosesRef.doc(id).get();
      if (closeDoc.exists) {
        alreadyDone.push(id);
        continue;
      }

      // 已在回填队列中 → 视为已排队
      const requestDoc = await backfillRequestsRef.doc(id).get();
      if (requestDoc.exists) {
        alreadyQueued.push(id);
      } else {
        toQueue.push(symbol);
      }
    }

    // 5) 写入回填队列（Batch 批处理写入）
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

      // 6) 发布 Pub/Sub（发布/订阅）消息（采用 JSON 负载，供订阅端用 event.data.json 直接取）
      const pubsub = getPubSub();
      await pubsub.topic("backfill-eod").publishMessage({
        json: { date, symbols: toQueue },
      });

      logger.info("[requestBackfillEod] published", {
        date,
        size: toQueue.length,
      });
    } else {
      logger.info("[requestBackfillEod] nothing-new-after-dedup", {
        date,
        accepted: uniqueSymbols.length,
      });
    }

    // 7) 返回摘要（Summary）
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