// functions/src/index.ts

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { runCloseForSymbols } from "./lib/close/run";
import { MAX_SYMBOLS_PER_CALL } from "./config/limits";

// ---- Firebase Admin 初始化（initialize，初始化）----
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// Secrets（密钥，供外部 API 使用）
const FMP_TOKEN = defineSecret("FMP_TOKEN");                 // Financial Modeling Prep（FMP，财经数据接口）实时价
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

// —— 工具：纽约日校验（YYYY-MM-DD）
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function nyTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// —— 服务器侧符号归一化（normalize，归一化）：trim → NFKC → 去内部空白 → 大写
function normalizeSymbolForServer(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

// —— 小工具：带超时的 fetch（timeout，超时）
// 当前仅供后续可能的扩展使用；即便暂时未被引用也保留，避免重复实现。
async function fetchWithTimeout(input: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * getOfficialClose（官方收盘价批量写库）：
 * 入参：{ date:"YYYY-MM-DD", symbols:string[] }
 * 约束：date 不得晚于 NY 今日；symbols 上限保护；内部 runCloseForSymbols 落库 officialCloses
 */
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
        `Date ${date} is in the future for America/New_York. Today is ${todayNy}.`
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

    // 3) 取 db + 组织 secrets（此处 secrets 只是传递给下游 provider）
    const db = admin.firestore();
    const secrets = {
      FMP_TOKEN: FMP_TOKEN.value() || "",
      MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
      STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
    };

    // 4) 核心执行（统一写入 officialCloses/{date_symbol}）
    const results = await runCloseForSymbols(db, date, uniq, secrets);
    return results;
  }
);

// —— 单独文件中实现的 HTTP/Callable 云函数在此汇总导出 ——
// 实时价格云函数：从独立文件 functions/src/price/price-quote.ts 转发导出
export { priceQuote } from "./price/price-quote";

// —— 其他导出（保持不变/追加新能力）——
export { eodJob } from "./jobs/eod";
export { requestBackfillEod } from "./admin/request-backfill-eod";
export { backfillWorker } from "./jobs/backfill-worker";
// 如项目中存在该文件则保留；若没有此管理接口文件，可删除下一行导出避免构建报错
export { setEodSymbols } from "./admin/set-eod-symbols";
