// functions/src/price/price-quote.ts
import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";

const FINNHUB_API_KEY = defineSecret("FINNHUB_API_KEY");

type FinnhubQuote = {
  c: number | null;  // current price 当前价格
  h?: number;        // high  最高价
  l?: number;        // low   最低价
  o?: number;        // open  今开
  pc?: number;       // previous close 昨收
  t?: number;        // time 时间戳
};

/**
 * priceQuote 云函数（Cloud Function 云函数）
 * - 入参：{ symbol: string }
 * - 出参：{ price: number | null }
 * - 内部：调用 Finnhub /quote 接口，取 c 作为当前价格
 *
 * 注意：本版本只返回价格，不写任何 Firestore（文档数据库），
 * 避免对现有数据库结构产生影响。
 */
export const priceQuote = onCall(
  {
    region: "us-central1",
    secrets: [FINNHUB_API_KEY],
  },
  async (request): Promise<{ price: number | null }> => {
    const rawSymbol = (request.data?.symbol ?? request.data?.Symbol ?? "").toString().trim();

    if (!rawSymbol) {
      logger.warn("priceQuote called without symbol");
      return { price: null };
    }

    const symbol = rawSymbol.toUpperCase();
    const apiKey = FINNHUB_API_KEY.value();

    if (!apiKey) {
      logger.error("FINNHUB_API_KEY is not set");
      return { price: null };
    }

    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
      symbol,
    )}&token=${apiKey}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.error("priceQuote Finnhub HTTP error", {
          status: res.status,
          statusText: res.statusText,
        });
        return { price: null };
      }

      const data = (await res.json()) as FinnhubQuote;
      const c = data?.c;

      const price =
        typeof c === "number" && Number.isFinite(c)
          ? c
          : null;

      if (price == null) {
        logger.warn("priceQuote: Finnhub returned invalid price", { symbol, data });
      }

      return { price };
    } catch (err) {
      logger.error("priceQuote Finnhub request failed", { symbol, err });
      return { price: null };
    }
  },
);