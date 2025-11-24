import * as admin from "firebase-admin";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { runCloseForSymbols } from "./lib/close/run";
import { MAX_SYMBOLS_PER_CALL } from "./config/limits";

// ★ 实时 EOD 定时任务
import {
  realtimeEodPass1,
  realtimeEodPass2,
  realtimeEodPass3,
  realtimeEodPass4,
  realtimeEodPass5,
} from "./jobs/realtime-eod";

// ★ 自动从交易记录维护 EOD 标的列表
import {
  refreshEodSymbolsFromTransactions,
  refreshEodSymbolsFromTransactionsOnDemand,
} from "./jobs/refresh-eod-symbols-from-transactions";

// ---- Firebase Admin 初始化 ----
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// Secrets
const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

// —— 工具 ——
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function nyTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function normalizeSymbolForServer(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

// ==========================================
// ★★★ [内置维护工具箱] 直接写在这里，确保能找到 ★★★
// ==========================================
// ==========================================
// ★★★ [内置维护工具箱] 导入外部定义 ★★★
// ==========================================
export { maintenanceTool } from "./admin/maintenance";
// ==========================================

// 原有函数导出
export const getOfficialClose = onCall(
  { region: "us-central1", timeoutSeconds: 120, secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY] },
  async (request) => {
    const date = (request?.data?.date ?? "") as string;
    const rawSymbols = (request?.data?.symbols ?? []) as unknown[];
    if (!DATE_RE.test(date)) throw new HttpsError("invalid-argument", 'Date must be "YYYY-MM-DD".');
    const todayNy = nyTodayYmd();
    if (date > todayNy) throw new HttpsError("invalid-argument", `Date ${date} is in the future.`);
    if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) throw new HttpsError("invalid-argument", "Symbols must be non-empty.");

    const uniq = Array.from(new Set(rawSymbols.map(normalizeSymbolForServer).filter(Boolean)));
    if (uniq.length > MAX_SYMBOLS_PER_CALL) throw new HttpsError("resource-exhausted", "Too many symbols.");

    const db = admin.firestore();
    const secrets = {
      FMP_TOKEN: FMP_TOKEN.value() || "",
      MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
      STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
    };
    return await runCloseForSymbols(db, date, uniq, secrets);
  }
);

export { priceQuote } from "./price/price-quote";
export { eodJob } from "./jobs/eod";
export { requestBackfillEod } from "./admin/request-backfill-eod";
export { backfillWorker } from "./jobs/backfill-worker";
export { setEodSymbols } from "./admin/set-eod-symbols";

export {
  realtimeEodPass1, realtimeEodPass2, realtimeEodPass3, realtimeEodPass4, realtimeEodPass5
} from "./jobs/realtime-eod";

export {
  refreshEodSymbolsFromTransactions, refreshEodSymbolsFromTransactionsOnDemand
} from "./jobs/refresh-eod-symbols-from-transactions";

export { manualRunEodForMetaSymbols } from "./jobs/manual-eod-from-meta";