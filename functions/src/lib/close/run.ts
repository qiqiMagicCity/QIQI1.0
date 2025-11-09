import * as admin from "firebase-admin";
import { getCloseWithFailover, buildDefaultCloseProviders } from "./priority";
import { fmpProvider } from "../../providers/close/fmp";
import { getNyDate } from "../../../lib/ny-time";
import { HttpsError } from "firebase-functions/v1/https";

export type CloseSecrets = {
  FMP_TOKEN: string;
  MARKETSTACK_API_KEY?: string;
  STOCKDATA_API_KEY?: string;
};

export async function fetchAndSaveOfficialClose(
  db: admin.firestore.Firestore,
  symbol: string,
  date: string,
  secrets: CloseSecrets
): Promise<{ status: 'ok' | 'error', close?: number, message?: string }> {
  const docId = `${date}_${symbol}`;
  const docRef = db.collection("officialCloses").doc(docId);
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  try {
    const nowNyYmd = getNyDate().toFormat("yyyy-MM-dd");
    if (date > nowNyYmd) {
      throw new HttpsError(
        "invalid-argument",
        "date is in the future for America/New_York",
        { date, tz: "America/New_York" }
      );
    }

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
      throw new HttpsError(
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
    }

    const res = await getCloseWithFailover(chain, symbol, date, secrets);

    const successData = {
      symbol,
      date,
      close: res.close,
      currency: res.currency ?? "USD",
      source: "official",
      provider: res.provider,
      tz: "America/New_York",
      status: "ok",
      latencyMs: res.latencyMs,
      attempts: Array.isArray(res.attempts) ? res.attempts : [],
      runId,
      retrievedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await docRef.set(successData, { merge: true });
    return { status: "ok", close: res.close };
  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }

    const attempts = Array.isArray((error as any)?.cause?.attempts)
      ? (error as any).cause.attempts
      : [];
    const errorData = {
      symbol,
      date,
      source: "official",
      tz: "America/New_York",
      status: "error",
      message: (error as Error).message,
      attempts,
      runId,
      retrievedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await docRef.set(errorData, { merge: true });
    return { status: "error", message: error.message };
  }
}

export async function runCloseForSymbols(
  db: admin.firestore.Firestore,
  date: string,
  symbols: string[],
  secrets: CloseSecrets
) {
  const results: Record<string, any> = {};
  for (const symbol of symbols) {
    results[symbol] = await fetchAndSaveOfficialClose(db, symbol, date, secrets);
  }
  return results;
}
