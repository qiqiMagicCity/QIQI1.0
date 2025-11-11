// functions/src/lib/close/run.ts
import * as admin from "firebase-admin";
import { getCloseWithFailover, buildDefaultCloseProviders } from "./priority";
import { fmpProvider } from "../../providers/close/fmp";
import { HttpsError } from "firebase-functions/v1/https";

export type CloseSecrets = {
  FMP_TOKEN: string;
  MARKETSTACK_API_KEY?: string;
  STOCKDATA_API_KEY?: string;
};

// 纽约“今天”的 YYYY-MM-DD（不依赖外部文件）
const nyTodayYmd = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * 单标的写库执行者（成功写 ok+close；失败写 error，不写 close）
 * - 成功：返回 {status:'ok', close}
 * - 失败：写入 error 文档后 **抛出异常**（给调用方区分成功/失败）
 */
export async function fetchAndSaveOfficialClose(
  db: admin.firestore.Firestore,
  symbol: string,
  date: string,
  secrets: CloseSecrets
): Promise<{ status: "ok"; close: number }> {
  const upperSymbol = symbol.toUpperCase().trim();
  const docId = `${date}_${upperSymbol}`;
  const docRef = db.collection("officialCloses").doc(docId);
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  try {
    // 纽约日期“未来”保护
    const nowNyYmd = nyTodayYmd();
    if (date > nowNyYmd) {
      const err = new HttpsError(
        "invalid-argument",
        "date is in the future for America/New_York",
        { date, tz: "America/New_York" }
      );
      throw err;
    }

    // 根据可用密钥决定可用数据源
    const enabledProviders = {
      enableMarketstack: !!secrets.MARKETSTACK_API_KEY,
      enableStockdata: !!secrets.STOCKDATA_API_KEY,
    };

    const chain = buildDefaultCloseProviders([fmpProvider], {
      ...enabledProviders,
      targetYmd: date,
      nowNyYmd,
    });

    if (chain.length === 0) {
      const err = new HttpsError(
        "failed-precondition",
        "no provider covers the requested date",
        {
          date,
          tz: "America/New_York",
          enabledProviders,
          reason: "no_provider_covers_date",
          hint: "Marketstack≈365d, StockData≈45d, FMP≈2000d",
        }
      );
      throw err;
    }

    const res = await getCloseWithFailover(chain, upperSymbol, date, secrets);

    const successData = {
      status: "ok" as const,
      close: res.close,
      currency: res.currency ?? "USD",
      provider: res.provider,
      tz: "America/New_York",
      source: "official",
      symbol: upperSymbol,
      date,
      retrievedAt: admin.firestore.FieldValue.serverTimestamp(),
      runId,
      latencyMs: res.latencyMs,
      attempts: Array.isArray(res.attempts) ? res.attempts : [],
    };

    await docRef.set(successData, { merge: true });
    return { status: "ok", close: res.close };
  } catch (error: any) {
    // 规范失败写库（绝不写 close），并抛出异常给上层判定失败
    const attempts = Array.isArray(error?.cause?.attempts) ? error.cause.attempts : [];
    const errorData = {
      status: "error" as const,
      message: (error as Error)?.message ?? "unknown",
      tz: "America/New_York",
      source: "official",
      symbol: upperSymbol,
      date,
      retrievedAt: admin.firestore.FieldValue.serverTimestamp(),
      runId,
      attempts,
    };
    await docRef.set(errorData, { merge: true });

    // 保留原始 HttpsError 语义（eod.ts 需区分跳过场景）
    if (error instanceof HttpsError) {
      throw error;
    } else {
      const err = new Error(
        (error as Error)?.message ?? "fetchAndSaveOfficialClose failed"
      ) as any;
      err.code = "unknown";
      throw err;
    }
  }
}

/**
 * eod 定时任务的批处理入口：
 * - **吞掉单标的异常**，统一返回 {symbol: {status:'ok'|'error', ...}}
 * - 方便统计成功/失败数量，不中断整批
 */
export async function runCloseForSymbols(
  db: admin.firestore.Firestore,
  date: string,
  symbols: string[],
  secrets: CloseSecrets
) {
  const results: Record<string, any> = {};
  const uniq = Array.from(
    new Set((symbols ?? []).filter(Boolean).map((s) => s.toUpperCase().trim()))
  );

  for (const sym of uniq) {
    try {
      const r = await fetchAndSaveOfficialClose(db, sym, date, secrets);
      results[sym] = r; // {status:'ok', close}
    } catch (e: any) {
      results[sym] = {
        status: "error",
        message: e?.message,
        code: e?.code,
      };
    }
  }
  return results;
}
