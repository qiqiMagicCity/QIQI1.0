// functions/src/jobs/backfill-worker.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions"; // 正确引入 logger（日志记录器）
import { fetchAndSaveOfficialClose, CloseSecrets } from "../lib/close/run";
import {
  BACKFILL_WORKER_CHUNK_SIZE,
  BACKFILL_WORKER_CONCURRENCY,
} from "../config/limits";

// Admin SDK（管理端 SDK）幂等初始化
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// Secrets（密钥，来自 Secret Manager）
const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 简单的并发执行器（concurrency limiter） */
async function executeConcurrently<T>(
  tasks: Array<() => Promise<T>>,
  concurrencyLimit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let currentIndex = 0;

  while (currentIndex < tasks.length) {
    const slice = tasks
      .slice(currentIndex, currentIndex + concurrencyLimit)
      .map((fn) => fn());
    const settled = await Promise.allSettled(slice);
    results.push(...settled);
    currentIndex += slice.length;
  }
  return results;
}

/** 统一解析不同形态的 Pub/Sub（发布/订阅）payload */
function extractPayload(event: any): { date?: string; symbols?: unknown } | null {
  try {
    // v2 包装：event.data.message.json（如果发布时用 json 形式）
    const nested = event?.data?.message?.json;
    if (nested && typeof nested === "object") return nested;
  } catch {}
  try {
    // 某些本地/代理形态：event.data.json
    const direct = event?.data?.json;
    if (direct && typeof direct === "object") return direct;
  } catch {}
  try {
    // 标准 base64：event.data.message.data
    const rawMsg = event?.data?.message ?? {};
    const b64: string | undefined = rawMsg.data;
    if (typeof b64 === "string" && b64.length > 0) {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(decoded);
    }
  } catch (e: any) {
    logger.error("[backfillWorker] JSON parse failed", {
      error: String(e?.message ?? e),
    });
  }
  return null;
}

export const backfillWorker = onMessagePublished(
  {
    topic: "backfill-eod",
    secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
    maxInstances: 1, // 限流：单实例（避免撞限/超配额）
  },
  async (event) => {
    const db = getFirestore();

    // 固定集合路径：meta/backfill/requests（注意：是 meta/backfill/requests，不是 meta/backfillRequests）
    const backfillRef = db.collection("meta").doc("backfill").collection("requests");
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    // 解析消息
    const payload = extractPayload(event);
    if (!payload) {
      logger.error("[backfillWorker] Empty/invalid PubSub message; skip.");
      return;
    }

    const date = String(payload.date ?? "").trim();
    const symbolsRaw = Array.isArray(payload.symbols) ? payload.symbols : [];

    // 统一：去空白 → 字符串化 → 大写（uppercase）→ 去重
    const symbols: string[] = Array.from(
      new Set(
        symbolsRaw
          .map((s: any) => String(s ?? "").trim())
          .filter((s: string) => s.length > 0)
          .map((s: string) => s.toUpperCase())
      )
    );

    if (!DATE_RE.test(date) || symbols.length === 0) {
      logger.warn("[backfillWorker] Invalid payload", {
        date,
        symbolsLen: symbols.length,
      });
      return;
    }

    logger.info("[backfillWorker] queued", { date, size: symbols.length });

    // 标记 running（运行中）
    const runningBatch = db.batch();
    for (const symbol of symbols) {
      const docRef = backfillRef.doc(`${date}_${symbol}`);
      runningBatch.set(
        docRef,
        { status: "running", updatedAt: serverTimestamp, date, symbol },
        { merge: true }
      );
    }
    await runningBatch.commit();

    // 分片（chunking）+ 并发（concurrency）执行
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += BACKFILL_WORKER_CHUNK_SIZE) {
      chunks.push(symbols.slice(i, i + BACKFILL_WORKER_CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      const batchSyms = chunks[i];
      const start = Date.now();

      logger.info("[backfillWorker] running chunk", {
        chunkIndex: i + 1,
        chunksTotal: chunks.length,
        size: batchSyms.length,
        concurrency: BACKFILL_WORKER_CONCURRENCY,
      });

      // —— 正确的调用签名：fetchAndSaveOfficialClose(db, symbol, date, secrets)
      const factories = batchSyms.map((symbol) => {
        return async () => {
          try {
            await fetchAndSaveOfficialClose(
              db,
              symbol,
              date,
              {
                FMP_TOKEN: FMP_TOKEN.value(),
                MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value(),
                STOCKDATA_API_KEY: STOCKDATA_API_KEY.value(),
              } as CloseSecrets
            );
            return { symbol, ok: true as const };
          } catch (e: any) {
            return Promise.reject({
              symbol,
              message: e?.message,
              code: e?.code,
              hint: e?.details?.hint,
            });
          }
        };
      });

      const settled = await executeConcurrently(
        factories,
        BACKFILL_WORKER_CONCURRENCY
      );

      const results = settled.map((r) =>
        r.status === "fulfilled"
          ? { symbol: r.value.symbol, ok: true as const }
          : {
              symbol: r.reason?.symbol ?? "UNKNOWN",
              ok: false as const,
              error: {
                message: r.reason?.message,
                code: r.reason?.code,
                hint: r.reason?.hint,
              },
            }
      );

      const okCount = results.filter((r) => r.ok).length;
      const errCount = results.length - okCount;

      logger.info("[backfillWorker] chunk done", {
        chunkIndex: i + 1,
        chunksTotal: chunks.length,
        ms: Date.now() - start,
        ok: okCount,
        fail: errCount,
      });

      // 回写结果（done/error）
      const updateBatch = db.batch();
      const doneTs = serverTimestamp;
      for (const r of results) {
        const docRef = backfillRef.doc(`${date}_${r.symbol}`);
        if (r.ok) {
          updateBatch.set(
            docRef,
            { status: "done", updatedAt: doneTs },
            { merge: true }
          );
        } else {
          updateBatch.set(
            docRef,
            { status: "error", error: r.error, updatedAt: doneTs },
            { merge: true }
          );
        }
      }
      await updateBatch.commit();
    }
  }
);