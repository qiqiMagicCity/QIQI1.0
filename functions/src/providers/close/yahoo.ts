// functions/src/providers/close/yahoo.ts
import { CloseProvider } from "./interface";
// import yahooFinance from 'yahoo-finance2'; // Removed to avoid TS ESM issues

// We generally want to map exceptions to our standard error format if possible,
// but for now simple throwing is acceptable as the generic runner catches it.

export const yahooProvider: CloseProvider = {
    name: "yahoo",
    /**
     * getClose: Fetch EOD from Yahoo Finance.
     * Leverages yahoo-finance2 library. It supports historical data.
     * 
     * CAUTION: Yahoo Public API is unofficial. 'yahoo-finance2' library handles quirks.
     */
    async getClose(symbol, dateYYYYMMDD) {
        const startTs = Date.now();
        const upperSymbol = symbol.toUpperCase().trim();

        // Auto-detect Short Option Symbol and convert to OCC for Yahoo API call
        // But we DO NOT change upperSymbol, so that the result is saved under the requested (Short) symbol.
        let fetchSymbol = upperSymbol;
        const optionMatch = upperSymbol.match(/^([A-Z]+)(\d{6})([CP])([\d.]+)$/);
        if (optionMatch) {
            const [, ticker, date, type, priceStr] = optionMatch;
            if (priceStr.length !== 8 || priceStr.includes('.')) {
                const priceNum = parseFloat(priceStr);
                if (!isNaN(priceNum)) {
                    const scaled = Math.round(priceNum * 1000);
                    const padded = String(scaled).padStart(8, '0');
                    fetchSymbol = `${ticker}${date}${type}${padded}`;
                    console.log(`[yahoo] Converted Short Symbol ${upperSymbol} -> OCC ${fetchSymbol}`);
                }
            }
        }

        // 1. Resolve yahooFinance instance via require (bypass ESM/TS interop issues)
        let yf: any;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const pkg = require('yahoo-finance2');

            // Logic proven in debug-yahoo-v2.js
            if (typeof pkg.default === 'function') {
                yf = new pkg.default();
            } else if (typeof pkg === 'function') {
                yf = new pkg();
            } else {
                yf = pkg.default || pkg;
            }
        } catch (initErr: any) {
            console.error("[yahoo] Init failed", initErr);
            throw new Error(`Failed to initialize yahoo-finance2: ${initErr.message}`);
        }

        // 2. Prepare Date Range (NY Time aware)
        // dateYYYYMMDD is "2023-11-24".
        const queryDate = new Date(dateYYYYMMDD);

        // Safety: Fetch 1 year history (Standard for Annual PnL/YTD charts)
        // Reduced from 2 years to save memory/processing, while ensuring we cover "Start of Year" for YTD.
        const fromDate = new Date(queryDate);
        fromDate.setFullYear(fromDate.getFullYear() - 1);

        const nextDate = new Date(queryDate);
        nextDate.setDate(nextDate.getDate() + 2); // Go slightly past to ensure coverage

        const queryOptions = {
            period1: fromDate.toISOString().slice(0, 10),
            period2: nextDate.toISOString().slice(0, 10),
        };

        let result: any[];
        try {
            console.log(`[yahoo] Fetching ${fetchSymbol} period1=${queryOptions.period1} period2=${queryOptions.period2}`);
            // Use historical method
            result = await yf.historical(fetchSymbol, queryOptions);
        } catch (e: any) {
            // e.g. "Not Found"
            throw {
                message: e.message || "Yahoo Finance fetch failed",
                providerCode: e.code,
                httpStatus: 404, // assume 404 or mapped
                details: e
            };
        }

        const latencyMs = Date.now() - startTs;

        if (!Array.isArray(result) || result.length === 0) {
            throw new Error(`Yahoo Finance returned no data for ${upperSymbol}`);
        }

        // 3. Map to bulkEod format with UTC Date Parsing
        const bulkEod: Array<{
            date: string;
            close: number;
            currency: string;
        }> = [];

        for (const item of result) {
            if (!item.date || typeof item.close !== 'number') continue;

            // Fix: Use UTC methods to avoid time zone shifts (00:00:00Z -> previous day in EST)
            // Yahoo dates in historical() are usually Javascript Date objects set to UTC midnight.
            const y = item.date.getUTCFullYear();
            const m = String(item.date.getUTCMonth() + 1).padStart(2, '0');
            const d = String(item.date.getUTCDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;

            bulkEod.push({
                date: dateStr,
                close: item.close,
                currency: "USD" // Yahoo usually USD for US stocks, but we can't easily detect w/o quote summary. Assume USD.
            });
        }

        // 4. Find target
        const target = bulkEod.find(x => x.date === dateYYYYMMDD);

        if (target?.close === undefined) {
            // Debug log to help understand why we missed
            const nearby = bulkEod.filter(x => x.date >= dateYYYYMMDD).slice(0, 3);
            console.warn(`[yahoo] Missing specific date ${dateYYYYMMDD} for ${upperSymbol}. Nearby:`, nearby);

            throw new Error(`Yahoo Finance missing close for ${dateYYYYMMDD}`);
        }

        return {
            close: target.close,
            currency: "USD",
            provider: "yahoo",
            latencyMs,
            meta: {
                bulkEod // Return the 1 year history we fetched
            }
        };
    }
};
