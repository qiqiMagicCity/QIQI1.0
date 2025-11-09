// functions/src/index.ts
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { runCloseForSymbols } from "./lib/close/run";
import { MAX_SYMBOLS_PER_CALL } from "./config/limits";

try { admin.app(); } catch { admin.initializeApp(); }

// Secrets（与 runCloseForSymbols 内部使用一致）
const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

// —— 工具：纽约日校验
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function nyTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// —— 客户端符号归一化（与前端一致：trim → NFKC → 去内部空白 → 大写）
function normalizeSymbolForServer(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export const getOfficialClose = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
  },
  async (request) => {
    const date = (request?.data?.date ?? "") as string;
    const rawSymbols = (request?.data?.symbols ?? []) as unknown[];

    // 1) 参数校验
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
    if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
      throw new HttpsError("invalid-argument", "Symbols must be a non-empty array.");
    }

    // 2) 归一化 + 去重 + 上限
    const uniq = Array.from(
      new Set(rawSymbols.map(normalizeSymbolForServer).filter(Boolean))
    );
    if (uniq.length > MAX_SYMBOLS_PER_CALL) {
      throw new HttpsError(
        "resource-exhausted",
        `Too many symbols. Max ${MAX_SYMBOLS_PER_CALL}. Please split your request.`
      );
    }

    // 3) 取 db + 组织 secrets
    const db = admin.firestore();
    const secrets = {
      FMP_TOKEN: FMP_TOKEN.value() || "",
      MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
      STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
    };

    // 4) 核心执行
    const results = await runCloseForSymbols(db, date, uniq, secrets);
    return results;
  }
);

// 其他导出保持不变
export { eodJob } from "./jobs/eod";
export { setEodSymbols } from "./admin/set-eod-symbols";
export { requestBackfillEod } from "./admin/request-backfill-eod";
export { backfillWorker } from "./jobs/backfill-worker";
