// functions/src/providers/close/yahoo.ts
import { CloseProvider } from "./interface";

export const yahooProvider: CloseProvider = {
    name: "yahoo",
    async getClose(symbol, dateYYYYMMDD) {
        const startTs = Date.now();
        const upperSymbol = symbol.toUpperCase().trim();

        // 1. Symbol Normalization (Short -> OCC)
        let fetchSymbol = upperSymbol;
        const optionMatch = upperSymbol.match(/^([A-Z]+)(\d{6})([CP])([\d.]+)$/);
        if (optionMatch) {
            const [, ticker, date, type, priceStr] = optionMatch;
            // Only convert if not already in 8-digit padding
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

        // 2. Resolve yahooFinance instance
        let yf: any;
        try {
            const pkg = require('yahoo-finance2');
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

        // 3. Date Configuration
        const queryDate = new Date(dateYYYYMMDD);
        const fromDate = new Date(queryDate);
        fromDate.setFullYear(fromDate.getFullYear() - 1);
        const nextDate = new Date(queryDate);
        nextDate.setDate(nextDate.getDate() + 2);

        const queryOptions = {
            period1: fromDate.toISOString().slice(0, 10),
            period2: nextDate.toISOString().slice(0, 10),
        };

        // 4. Multi-Layer Fetching Strategy
        try {
            console.log(`[yahoo] Historical Fetch for ${fetchSymbol} (${queryOptions.period1} to ${queryOptions.period2})`);
            const results = await yf.historical(fetchSymbol, queryOptions);

            if (Array.isArray(results) && results.length > 0) {
                // Map results to standard dates
                const bulkEod = results
                    .filter(item => item.date && typeof item.close === 'number')
                    .map(item => ({
                        date: `${item.date.getUTCFullYear()}-${String(item.date.getUTCMonth() + 1).padStart(2, '0')}-${String(item.date.getUTCDate()).padStart(2, '0')}`,
                        close: item.close as number
                    }));

                const target = bulkEod.find(x => x.date === dateYYYYMMDD);
                if (target) {
                    return {
                        close: target.close,
                        currency: "USD",
                        provider: "yahoo",
                        latencyMs: Date.now() - startTs,
                        meta: { bulkEod }
                    };
                }
                console.warn(`[yahoo] Specific date ${dateYYYYMMDD} missing in historical results. Nearby:`, bulkEod.slice(-3));
            }
        } catch (e: any) {
            console.warn(`[yahoo] Historical failed for ${fetchSymbol}: ${e.message}. Trying fallbacks...`);
        }

        // Fallback 1: Options Chain (Very reliable for LEAPS/current options)
        try {
            const match = fetchSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
            if (match) {
                const [, ticker, dateStr, type] = match;
                const expiration = new Date(`20${dateStr.slice(0, 2)}-${dateStr.slice(2, 4)}-${dateStr.slice(4, 6)}T12:00:00Z`);

                const chain = await yf.options(ticker, { date: expiration });
                if (chain?.options?.[0]) {
                    const side = type === 'C' ? 'calls' : 'puts';
                    const contract = chain.options[0][side].find((c: any) => c.contractSymbol === fetchSymbol);

                    if (contract && typeof contract.lastPrice === 'number') {
                        console.log(`[yahoo] Found ${fetchSymbol} in options chain. Price: ${contract.lastPrice}`);
                        return {
                            close: contract.lastPrice,
                            currency: contract.currency || "USD",
                            provider: "yahoo-options",
                            latencyMs: Date.now() - startTs,
                            meta: { contract }
                        };
                    }
                }
            }
        } catch (chainErr: any) {
            console.warn(`[yahoo] Options chain fallback missed: ${chainErr.message}`);
        }

        // Fallback 2: Quote (The ultimate fallback, efficient for single symbol)
        try {
            console.log(`[yahoo] Quote Fallback for ${fetchSymbol}...`);
            const quote = await yf.quote(fetchSymbol);
            if (quote && (typeof quote.regularMarketPrice === 'number' || typeof quote.regularMarketPreviousClose === 'number')) {
                const price = quote.regularMarketPrice || quote.regularMarketPreviousClose;
                console.log(`[yahoo] Found ${fetchSymbol} via quote. Price: ${price}`);
                return {
                    close: price,
                    currency: quote.currency || "USD",
                    provider: "yahoo-quote",
                    latencyMs: Date.now() - startTs,
                    meta: { quote }
                };
            }
        } catch (quoteErr: any) {
            console.error(`[yahoo] All Yahoo fallbacks failed for ${fetchSymbol}:`, quoteErr.message);
        }

        throw new Error(`Yahoo Finance failed to resolve price for ${fetchSymbol} on ${dateYYYYMMDD}`);
    }
};
