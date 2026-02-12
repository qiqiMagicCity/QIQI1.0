// functions/src/admin/request-backfill-eod.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2"; // 结构化日志（Structured Logging）
import { PubSub } from "@google-cloud/pubsub";  // Pub/Sub（发布/订阅）
import { normalizeList } from "../lib/symbols/normalize";
import { MAX_SYMBOLS_PER_BACKFILL_REQUEST } from "../config/limits";

// —— Firebase Admin（管理端 SDK）幂等初始化
if (!admin.apps.length) {
  admin.initializeApp();
}

const POLYGON_TOKEN = defineSecret("POLYGON_TOKEN");
const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

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
    secrets: [POLYGON_TOKEN, FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
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

    // 4) 幂等检查 (Idempotency)
    const backfillRequestsRef = db
      .collection("meta")
      .doc("backfill")
      .collection("requests");
    const officialClosesRef = db.collection("officialCloses");

    // [OPTIMIZATION] Direct Execution for Small Batches (Interactive Mode)
    // If the user requests <= 3 symbols, we just do it now. This avoids PubSub latency/config issues in Dev.
    if (uniqueSymbols.length <= 3) {
      logger.info("[requestBackfillEod] Small batch detected. Executing immediately (Bypass PubSub).", { symbols: uniqueSymbols });

      // Import dynamically to avoid top-level side effects if possible, or just use top-level
      const { fetchAndSaveOfficialClose } = await import("../lib/close/run");
      // We need secrets. In onCall, we can use defineSecret but accessing them might be tricky if not declared in dependencies.
      // However, for Yahoo we don't need keys.
      // Let's try to get secrets from process.env or just pass empty if we rely on Yahoo.
      // Actually, in v2 functions, secrets are bound to process.env if declared.
      // But this function didn't declare them in the signature above. 
      // We must rely on Yahoo fallback mainly.
      const secrets = {
        POLYGON_TOKEN: POLYGON_TOKEN.value(),
        FMP_TOKEN: FMP_TOKEN.value(),
        MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value(),
        STOCKDATA_API_KEY: STOCKDATA_API_KEY.value(),
      };

      const results = [];
      for (const symbol of uniqueSymbols) {
        try {
          // Update status to running
          const id = `${date}_${symbol}`;
          await backfillRequestsRef.doc(id).set({
            status: "running",
            createdAt: admin.firestore.Timestamp.now(),
            requestedBy: auth?.uid ?? null,
            date,
            symbol,
            mode: "direct_execution"
          });

          const res = await fetchAndSaveOfficialClose(db, symbol, date, secrets);

          // Update status to done
          await backfillRequestsRef.doc(id).set({
            status: "done",
            result: res.status,
            updatedAt: admin.firestore.Timestamp.now()
          }, { merge: true });

          results.push({ symbol, status: "ok", close: res.close });
        } catch (e: any) {
          logger.error(`[requestBackfillEod] Direct execution failed for ${symbol}`, e);
          const id = `${date}_${symbol}`;
          await backfillRequestsRef.doc(id).set({
            status: "error",
            error: e.message,
            updatedAt: admin.firestore.Timestamp.now()
          }, { merge: true });
          results.push({ symbol, status: "error", error: e.message });
        }
      }

      return {
        mode: "direct",
        results,
        queuedCount: 0,
        accepted: uniqueSymbols.length
      };
    }

    // [Fallback] Large Batch -> Use PubSub Queue
    for (const symbol of uniqueSymbols) {
      const id = `${date}_${symbol}`;
      // ... (Rest of deduplication logic)

      // 已有官方收盘价 → 视为已完成
      const closeDoc = await officialClosesRef.doc(id).get();
      if (closeDoc.exists && closeDoc.data()?.status === 'ok') {
        alreadyDone.push(id);
        continue;
      }

      toQueue.push(symbol);
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

      // 6) 发布 Pub/Sub
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