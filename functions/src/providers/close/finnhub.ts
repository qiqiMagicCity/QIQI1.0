import { CloseProvider } from "./interface";

export const finnhubEodProvider: CloseProvider = {
    name: "finnhub",
    async getClose(symbol, dateYYYYMMDD, secrets) {
        const apiKey = (secrets as any)["FINNHUB_API_KEY"];
        if (!apiKey) {
            throw new Error("FINNHUB_API_KEY secret not found");
        }

        // Determine strategy: Quote (for Today) or Candle (for History)
        // We can infer "Today" if date matches NY date? 
        // Or we just try Candle first (standard EOD) then Quote?
        // Finnhub Candle is standard for EOD. 
        // https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=D&from=...&to=...

        const dateObj = new Date(dateYYYYMMDD);
        // from/to need unix timestamp (seconds). 
        // To cover the full day YYYY-MM-DD in NY, we want open-close range?
        // Actually Finnhub takes timestamp.
        // 12:00 UTC on that day is safe?
        // Let's use start/end of day UTC? Or just set from=ts, to=ts+1day?

        // Easier strategy:
        // If date is "today" (approx), check Quote.
        // Otherwise use Candle.

        // For simplicity/robustness similar to other providers, let's just implement Candle logic 
        // because "Close" implies finalized day candle.

        // Convert YYYY-MM-DD to unix timestamp
        // We treat YYYY-MM-DD as NY day.
        const [y, m, d] = dateYYYYMMDD.split('-').map(Number);
        // Construct UTC midnight?
        // Finnhub resolution=D uses UTC days or Exchange days? Usually exchange.
        const fromTs = Math.floor(Date.UTC(y, m - 1, d, 9, 30) / 1000); // 09:30 UTC? No, markets open 9:30 ET = 13:30/14:30 UTC.
        // Safest bet for "Daily" resolution is just From = 00:00 UTC of that day, To = 23:59 UTC of that day.
        const startOfDayTs = Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000);
        const endOfDayTs = startOfDayTs + 86400;

        const url = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${startOfDayTs}&to=${endOfDayTs}&token=${apiKey}`;

        const startTime = Date.now();
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Finnhub status ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        const latencyMs = Date.now() - startTime;

        // data: { c: [close...], t: [timestamp...], s: "ok" }
        if (data.s === "no_data") {
            // Fallback: If date is TODAY, try Quote endpoint
            // This is crucial for the "Server Side EOD" job running shortly after close
            const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
            const qRes = await fetch(quoteUrl);
            if (qRes.ok) {
                const qData = await qRes.json();
                if (qData && typeof qData.c === 'number' && qData.c > 0) {
                    return {
                        close: qData.c,
                        date: dateYYYYMMDD,
                        currency: "USD",
                        provider: "finnhub-quote", // distinguish source
                        latencyMs,
                    };
                }
            }
            throw new Error(`Finnhub returned no_data for ${dateYYYYMMDD}`);
        }

        if (data.s !== "ok" || !Array.isArray(data.c) || data.c.length === 0) {
            throw new Error(`Finnhub invalid response: ${JSON.stringify(data)}`);
        }

        // Match precise timestamp/date if possible?
        // Finnhub D resolution returns one candle for the day.
        const close = data.c[0];

        return {
            close,
            date: dateYYYYMMDD,
            currency: "USD",
            provider: "finnhub",
            latencyMs,
        };
    },
};
