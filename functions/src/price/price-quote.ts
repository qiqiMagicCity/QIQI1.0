// functions/src/price/price-quote.ts
import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

const FINNHUB_API_KEY = defineSecret("FINNHUB_API_KEY");

type FinnhubQuote = {
  c: number | null;  // current price 当前价格
  h?: number;        // high  最高价
  l?: number;        // low   最低价
  o?: number;        // open  今开
  pc?: number;       // previous close 昨收
  t?: number;        // time 时间戳（秒）
};

/**
 * priceQuote 云函数（Cloud Function 云函数）
 * - 入参：{ symbol: string }
 * - 出参：{ price: number | null }
 *
 * 现在的行为：
 * 1）照常调用 Finnhub /quote，取 c 作为当前价格；
 * 2）如果拿到有效价格，同时写入 Firestore：
 *    - 集合：stockDetails
 *    - 文档 ID：大写 symbol（例如 "AAPL"）
 *    - 字段：last（最后价格）、ts（毫秒时间戳）、provider、source、updatedAt
 */
export const priceQuote = onCall(
  {
    region: "us-central1",
    secrets: [FINNHUB_API_KEY],
  },
  async (request): Promise<{ price: number | null }> => {
    const rawSymbol = (request.data?.symbol ?? request.data?.Symbol ?? "")
      .toString()
      .trim();

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
          symbol,
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
        logger.warn("priceQuote: Finnhub returned invalid price", {
          symbol,
          data,
        });
        return { price: null };
      }

      // ===== 新增逻辑：把拿到的价格写入 stockDetails，给 realtimeEod 使用 =====
      try {
        const db = getFirestore();
        const nowMs = Date.now();

        await db
          .collection("stockDetails")
          .doc(symbol) // 文档 ID：大写 symbol，和 realtimeEodPass* 一致
          .set(
            {
              symbol,               // 标的代码
              last: price,          // 最后一次价格（给 EOD 用）
              ts: (data.t ?? Math.floor(nowMs / 1000)) * 1000, // 价格时间戳（毫秒）
              provider: "finnhub",  // 数据提供方
              source: "priceQuote", // 来源：priceQuote 云函数
              updatedAt: nowMs,     // 写入时间（毫秒）
            },
            { merge: true },        // 合并写入，避免覆盖掉将来可能扩展的字段
          );
      } catch (writeErr) {
        // 写库失败不影响主流程，只记一条日志
        logger.error("priceQuote: failed to write stockDetails", {
          symbol,
          err: writeErr,
        });
      }

      // 仍然把价格正常返回给前端
      return { price };
    } catch (err) {
      logger.error("priceQuote Finnhub request failed", { symbol, err });
      return { price: null };
    }
  },
);