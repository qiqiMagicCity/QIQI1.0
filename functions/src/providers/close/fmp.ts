// functions/src/providers/close/fmp.ts
import { CloseProvider } from "./interface";

/** 日期格式化 YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const fmpProvider: CloseProvider = {
  name: "fmp",
  /**
   * getClose：返回“目标日 EOD（End Of Day 收盘价）”
   * 同时从 FMP（Financial Modeling Prep 金融数据接口）
   * 一次性拉取过去 5 年的历史数据，并通过 meta.bulkEod 传给上层，
   * 由 run.ts 里负责批量写入 Firestore（云端文档数据库 Firestore）。
   */
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = (secrets as any)["FMP_TOKEN"];
    if (!token) {
      throw new Error("FMP_TOKEN secret not found");
    }

    const upperSymbol = symbol.toUpperCase().trim();

    // 计算 5 年前的起始日 fromYMD
    const targetDate = new Date(dateYYYYMMDD);
    if (Number.isNaN(targetDate.getTime())) {
      throw new Error(`Invalid date format: ${dateYYYYMMDD}`);
    }
    const fromDate = new Date(targetDate);
    fromDate.setFullYear(fromDate.getFullYear() - 5);
    const fromYMD = formatDate(fromDate);

    // FMP 5 年历史 Stable Endpoint（稳定端点）
    const url =
      "https://financialmodelingprep.com/stable/historical-price-eod/full" +
      `?symbol=${encodeURIComponent(upperSymbol)}` +
      `&from=${encodeURIComponent(fromYMD)}` +
      `&to=${encodeURIComponent(dateYYYYMMDD)}` +
      `&apikey=${encodeURIComponent(token)}`;

    const startTs = Date.now();
    let response: any;

    // 简单重试：429（配额限制 HTTP429）/ 5xx（服务器错误 5xx）
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
      let message = statusText;
      let providerCode: string | undefined;
      let retryAfter: string | number | undefined;

      try {
        const body = await response.clone().json();
        message = body.message || body["error-message"] || JSON.stringify(body);
        if (body?.code) providerCode = body.code;
      } catch {
        try {
          const text = await response.text();
          if (text) message = text;
        } catch {
          // 忽略二次解析错误
        }
      }

      retryAfter =
        response?.headers?.get?.("Retry-After") ||
        response?.headers?.get?.("X-Rate-Limit-Reset") ||
        undefined;

      // 抛出“带有 provider 元信息”的错误，供上层记录 attempts（尝试记录）
      throw {
        code:
          status === 401 || status === 403
            ? "permission-denied"
            : status === 429
              ? "resource-exhausted"
              : status >= 400 && status < 500
                ? "invalid-argument"
                : "unavailable",
        httpStatus: status,
        endpoint: url,
        providerCode,
        message,
        hint:
          status === 401 || status === 403
            ? "FMP API Key 无效或套餐权限不足"
            : status === 429
              ? "FMP 已限速，查看 Retry-After / X-Rate-Limit-Reset"
              : status >= 400 && status < 500
                ? "symbol 或参数无效"
                : "FMP 服务暂时不可用",
        rateLimitReset: retryAfter,
        ts: Date.now(),
      };
    }

    const list = await response.json();
    const latencyMs = Date.now() - startTs;

    // 新的 stable 接口返回的是“数组”，不是 { historical: [...] }
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("Invalid FMP response: empty EOD list");
    }

    // 整理出“可写入 Firestore 的 5 年 EOD 列表”
    const bulkEod: Array<{
      date: string;
      close: number;
      currency: string;
    }> = [];

    for (const item of list) {
      const d =
        typeof item?.date === "string" ? item.date.slice(0, 10) : undefined;
      const close = (item as any)?.close;
      if (!d || typeof close !== "number") continue;

      bulkEod.push({
        date: d,
        close,
        currency: "USD",
      });
    }

    if (bulkEod.length === 0) {
      throw new Error("No valid EOD rows from FMP");
    }

    // 找到“目标日”的那一条
    const targetRow = bulkEod.find((row) => row.date === dateYYYYMMDD);
    // [FIX] Do NOT throw if target date missing (e.g. weekend), as we want to save the bulk history.
    // if (!targetRow) {
    //   throw new Error(`No EOD data for ${dateYYYYMMDD} from FMP`);
    // }

    // 返回给系统：目标日 EOD + meta.bulkEod（5 年历史）
    return {
      close: targetRow?.close as number, // May be undefined if missing
      currency: "USD",
      provider: "fmp",
      latencyMs,
      meta: {
        bulkEod, // ★ 关键：5 年 EOD 列表，由 run.ts 负责写入 officialCloses
      },
    };
  },
};