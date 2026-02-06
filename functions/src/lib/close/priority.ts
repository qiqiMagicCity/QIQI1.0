// functions/src/lib/close/priority.ts
import { CloseProvider } from "../../providers/close/interface";
import { coversDate } from "./capabilities";
import { fmpProvider } from "../../providers/close/fmp";
import { yahooProvider } from "../../providers/close/yahoo";
import { finnhubEodProvider } from "../../providers/close/finnhub";

/** 调用尝试的记录（便于排障） */
interface Attempt {
  p: string; // provider name (简写)
  s: "ok" | "skipped" | "error";
  provider?: string;
  symbol?: string;
  error?: { message: string; code?: string };
  code?: string | number;
  httpStatus?: number;
  endpoint?: string;
  providerCode?: string | number;
  hint?: string;
  rateLimitReset?: string | number;
  ts?: number;
}

/**
 * 清理 Attempt 里的 undefined 字段，避免 Firestore 拒绝写入
 * - 所有值为 undefined 的字段都不写入
 * - error 对象内部同样做一次清理
 */
function sanitizeAttempt(input: Attempt): Attempt {
  const out: any = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;

    if (key === "error" && value && typeof value === "object") {
      const errOut: any = {};
      for (const [ek, ev] of Object.entries(value as any)) {
        if (ev !== undefined) {
          errOut[ek] = ev;
        }
      }
      out.error = errOut;
    } else {
      out[key] = value;
    }
  }

  return out as Attempt;
}

/* ---------------- Inlined Marketstack Provider ---------------- */
export const marketstackProvider: CloseProvider = {
  name: "marketstack",
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const apiKey = (secrets as any)["MARKETSTACK_API_KEY"];
    if (!apiKey) {
      throw new Error("MARKETSTACK_API_KEY secret not found");
    }

    const url = `http://api.marketstack.com/v1/eod?access_key=${apiKey}&symbols=${symbol}&date_from=${dateYYYYMMDD}&date_to=${dateYYYYMMDD}&limit=1`;
    const startTime = Date.now();
    let response: any;

    // 轻量重试：处理 429/5xx
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url);
        if (response?.status !== 429 && response?.status < 500) {
          break;
        }
      } catch (e) {
        if (i === 1) throw e;
      }
      await new Promise((res) => setTimeout(res, 200));
    }

    if (!response || !response.ok) {
      const status = response?.status ?? -1;
      const statusText = response?.statusText ?? "No Response";
      throw new Error(
        `Marketstack API 请求失败: ${statusText} (status: ${status})`
      );
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error(`Marketstack 返回 ${dateYYYYMMDD} 无数据`);
    }

    const priceData = data.data[0];
    const extractedDate = String(priceData?.date || "").slice(0, 10);

    if (typeof priceData?.close !== "number" || extractedDate !== dateYYYYMMDD) {
      throw new Error(
        `Marketstack 返回无效数据：期望 ${dateYYYYMMDD}，实际 ${extractedDate}`
      );
    }

    return {
      close: priceData.close,
      date: dateYYYYMMDD,
      currency: "USD",
      provider: "marketstack",
      latencyMs,
      meta: { exchange: priceData.exchange, volume: priceData.volume },
    };
  },
};

/* ---------------- Inlined StockData.org Provider ---------------- */
export const stockdataProvider: CloseProvider = {
  name: "stockdata",
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const apiKey = (secrets as any)["STOCKDATA_API_KEY"];
    if (!apiKey) {
      throw new Error("STOCKDATA_API_KEY secret not found");
    }

    const startTime = Date.now();

    // 首选 date 参数
    const url1 = `https://api.stockdata.org/v1/data/eod?api_token=${apiKey}&symbols=${symbol}&date=${dateYYYYMMDD}&limit=1`;
    let response: any = await fetch(url1);

    if (!response?.ok) {
      const status = response?.status ?? -1;
      const statusText = response?.statusText ?? "No Response";
      throw new Error(
        `StockData.org API 请求失败: ${statusText} (status: ${status})`
      );
    }

    let data: any = await response.json();

    // 兜底：改用 date_from/date_to
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      const url2 = `https://api.stockdata.org/v1/data/eod?api_token=${apiKey}&symbols=${symbol}&date_from=${dateYYYYMMDD}&date_to=${dateYYYYMMDD}&limit=1`;
      response = await fetch(url2);

      if (!response?.ok) {
        const status = response?.status ?? -1;
        const statusText = response?.statusText ?? "No Response";
        throw new Error(
          `StockData.org 兜底请求失败: ${statusText} (status: ${status})`
        );
      }

      data = await response.json();

      if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
        throw new Error(
          `StockData.org 返回 ${dateYYYYMMDD} 无数据（date 与 date_from/date_to 均为空）`
        );
      }
    }

    const latencyMs = Date.now() - startTime;
    const priceData = data.data[0];
    const extractedDate = String(priceData?.date || "").slice(0, 10);

    if (typeof priceData?.close !== "number" || extractedDate !== dateYYYYMMDD) {
      throw new Error(
        `StockData.org 返回无效数据：期望 ${dateYYYYMMDD}，实际 ${extractedDate}`
      );
    }

    return {
      close: priceData.close,
      date: dateYYYYMMDD,
      currency: "USD",
      provider: "stockdata",
      latencyMs,
      meta: { volume: priceData.volume },
    };
  },
};

/**
 * 构建“官方收盘价（EOD, End Of Day）”供应商优先级列表。
 * 修正点：现在“默认”就包含 FMP、Marketstack、StockData.org，
 * 这样 request-backfill-eod 的“覆盖校验”不会因为 providers 为空而恒为 false。
 *
 * 可通过 opts 开关选择性启用；如未指定 opts，默认三个都包含。
 */
export function buildDefaultCloseProviders(
  existing: CloseProvider[] = [],
  opts?: {
    enableMarketstack?: boolean;
    enableStockdata?: boolean;
    enableYahoo?: boolean;
    enableFinnhub?: boolean;
    targetYmd?: string; // 目标纽约日
    nowNyYmd?: string; // 当前纽约日
  }
): CloseProvider[] {
  // 1) 基础顺序：FMP → Marketstack → StockData.org → Yahoo
  const providers: CloseProvider[] = [
    ...existing,
    fmpProvider, // 始终先尝试 FMP
  ];

  // 未显式关闭则默认启用
  const useMarketstack =
    opts?.enableMarketstack === undefined ? true : !!opts.enableMarketstack;
  const useStockdata =
    opts?.enableStockdata === undefined ? true : !!opts.enableStockdata;
  const useYahoo =
    opts?.enableYahoo === undefined ? true : !!opts.enableYahoo;
  const useFinnhub =
    opts?.enableFinnhub === undefined ? true : !!opts.enableFinnhub;

  if (useFinnhub) providers.push(finnhubEodProvider);
  if (useMarketstack) providers.push(marketstackProvider);
  if (useStockdata) providers.push(stockdataProvider);
  // [USER RULE] Yahoo is the ultimate backstop/safety net.
  if (useYahoo) providers.push(yahooProvider);

  // 2) 去重（按 name 保留首次出现）
  const uniqueProvidersMap = new Map<string, CloseProvider>();
  for (const p of providers) {
    if (!uniqueProvidersMap.has(p.name)) {
      uniqueProvidersMap.set(p.name, p);
    }
  }
  let uniqueProviders = Array.from(uniqueProvidersMap.values());

  // 3) 覆盖期过滤（可选；仅当同时提供 targetYmd/nowNyYmd）
  if (opts?.targetYmd && opts?.nowNyYmd) {
    uniqueProviders = uniqueProviders.filter((p) =>
      coversDate(p.name, opts.targetYmd!, opts.nowNyYmd!)
    );
  }

  return uniqueProviders;
}

/**
 * 失败转移（failover）：按 providers 顺序依次尝试获取某日 EOD。
 * 任一成功即返回，并携带 attempts（尝试记录）方便排障。
 *
 * 从当前版本开始，额外支持 ctx（上下文），用于把 db 等对象传给 provider：
 * - ctx 结构不做强约束，由调用方约定。
 */
/**
 * 失败转移（failover）：按 providers 顺序依次尝试获取某日 EOD。
 * 任一成功即返回，并携带 attempts（尝试记录）方便排障。
 * 
 * [Robustness Fix]: 
 * - Ensures the loop NEVER crashes due to a provider error.
 * - Wraps logging and attempt recording in nested try/catch to prevent side-effect crashes.
 */
export async function getCloseWithFailover(
  providers: CloseProvider[],
  symbol: string,
  date: string,
  secrets: Record<string, string>,
  ctx?: any
) {
  const attempts: Attempt[] = [];
  let result: Awaited<ReturnType<CloseProvider["getClose"]>> | null = null;

  for (const provider of providers) {
    if (result) {
      // 已成功则后续标记为跳过
      try {
        attempts.push(sanitizeAttempt({ p: provider.name, s: "skipped" }));
      } catch (_) { /* ignore */ }
      continue;
    }

    try {
      console.log(`[Failover] Trying provider '${provider.name}' for ${symbol}...`);
      const closeData = await provider.getClose(symbol, date, secrets, ctx);
      result = closeData;
      console.log(`[Failover] Provider '${provider.name}' SUCCEEDED.`);

      try {
        attempts.push(sanitizeAttempt({ p: provider.name, s: "ok" }));
      } catch (_) { /* ignore */ }

    } catch (e: any) {
      // [DIAGNOSISLESS] Log immediately when a provider fails, don't wait for the end.
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[Failover] Provider '${provider.name}' THREW Error for ${symbol}@${date}. Recovering & Continuing...`, {
        error: errMsg,
        httpStatus: e?.httpStatus,
      });

      try {
        const rawAttempt: Attempt = {
          p: provider.name,
          provider: provider.name,
          symbol,
          s: "error",
          error: { message: errMsg, code: e?.code },
          code: e?.code,
          httpStatus: e?.httpStatus,
          endpoint: e?.endpoint,
          providerCode: e?.providerCode,
          hint: e?.hint,
          rateLimitReset: e?.rateLimitReset,
          ts: e?.ts ?? Date.now(),
        };
        attempts.push(sanitizeAttempt(rawAttempt));
      } catch (recErr) {
        console.error(`[Failover] Failed to record attempt for '${provider.name}'`, recErr);
      }
    }
  }

  if (result) {
    return { ...result, attempts };
  }

  throw new Error("All providers failed to get close price", {
    cause: attempts as any,
  });
}