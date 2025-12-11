// functions/src/jobs/backfill-worker.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { fetchAndSaveOfficialClose, CloseSecrets } from "../lib/close/run"; // 假设此路径正确
import {
  BACKFILL_WORKER_CHUNK_SIZE,
  BACKFILL_WORKER_CONCURRENCY,
} from "../config/limits";

// 初始化
try { admin.app(); } catch { admin.initializeApp(); }

const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- 辅助：获取 NY 时间 ---
const nyTodayYmd = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// ... (保留原有的 executeConcurrently 和 extractPayload 函数不变) ...
async function executeConcurrently<T>(
  tasks: Array<() => Promise<T>>,
  concurrencyLimit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let currentIndex = 0;
  while (currentIndex < tasks.length) {
    const slice = tasks.slice(currentIndex, currentIndex + concurrencyLimit).map((fn) => fn());
    const settled = await Promise.allSettled(slice);
    results.push(...settled);
    currentIndex += slice.length;
  }
  return results;
}

function extractPayload(event: any): { date?: string; symbols?: unknown } | null {
  try {
    const nested = event?.data?.message?.json;
    if (nested && typeof nested === "object") return nested;
  } catch { }
  try {
    const direct = event?.data?.json;
    if (direct && typeof direct === "object") return direct;
  } catch { }
  try {
    const rawMsg = event?.data?.message ?? {};
    const b64: string | undefined = rawMsg.data;
    if (typeof b64 === "string" && b64.length > 0) {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(decoded);
    }
  } catch (e: any) {
    logger.error("[backfillWorker] JSON parse failed", { error: String(e?.message ?? e) });
  }
  return null;
}
// ... (辅助函数结束) ...

export const backfillWorker = onMessagePublished(
  {
    topic: "backfill-eod",
    secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
    maxInstances: 10,
  },
  async (event) => {
    const db = getFirestore();
    const backfillRef = db.collection("meta").doc("backfill").collection("requests");
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    const payload = extractPayload(event);
    if (!payload) return;

    const date = String(payload.date ?? "").trim();
    const symbolsRaw = Array.isArray(payload.symbols) ? payload.symbols : [];

    // 清洗 symbols
    const symbols: string[] = Array.from(new Set(
      symbolsRaw
        .map((s: any) => String(s ?? "").trim())
        .filter((s: string) => s.length > 0)
        .map((s: string) => s.toUpperCase())
    ));

    if (!DATE_RE.test(date) || symbols.length === 0) {
      return;
    }

    // --- 核心修正：Time Guard (9.3 规则) ---
    const today = nyTodayYmd();
    if (date >= today) {
      logger.warn("[backfillWorker] BLOCKED: Attempt to backfill future/today data. Only history allowed.", {
        requestDate: date,
        todayNy: today,
        rule: "GlobalRules 9.3 Time Guard"
      });
      return; // 直接中止，保护实时定盘的权威性
    }
    // -------------------------------------

    logger.info("[backfillWorker] queued", { date, size: symbols.length });

    // 1. 标记 Running
    const runningBatch = db.batch();
    for (const symbol of symbols) {
      runningBatch.set(
        backfillRef.doc(`${date}_${symbol}`),
        { status: "running", updatedAt: serverTimestamp, date, symbol },
        { merge: true }
      );
    }
    await runningBatch.commit();

    // 2. 执行回填 (保留原逻辑)
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += BACKFILL_WORKER_CHUNK_SIZE) {
      chunks.push(symbols.slice(i, i + BACKFILL_WORKER_CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      const batchSyms = chunks[i];

      // 工厂函数
      const factories = batchSyms.map((symbol) => async () => {
        try {
          await fetchAndSaveOfficialClose(
            db, symbol, date,
            {
              FMP_TOKEN: FMP_TOKEN.value(),
              MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value(),
              STOCKDATA_API_KEY: STOCKDATA_API_KEY.value(),
            } as CloseSecrets
          );
          return { symbol, ok: true as const };
        } catch (e: any) {
          return Promise.reject({ symbol, message: e?.message });
        }
      });

      const settled = await executeConcurrently(factories, BACKFILL_WORKER_CONCURRENCY);

      // 处理结果
      const updateBatch = db.batch();
      for (const r of settled) {
        if (r.status === "fulfilled") {
          updateBatch.set(
            backfillRef.doc(`${date}_${r.value.symbol}`),
            { status: "done", updatedAt: serverTimestamp },
            { merge: true }
          );
        } else {
          const reason = r.reason as any;
          updateBatch.set(
            backfillRef.doc(`${date}_${reason?.symbol}`),
            { status: "error", error: reason?.message, updatedAt: serverTimestamp },
            { merge: true }
          );
        }
      }
      await updateBatch.commit();
    }
  }
);