
// Diagnostic test for computeDayPnLSymbol fallback logic
import { toNyCalendarDayString } from '../src/lib/ny-time';

// Mocking the environment
const FRESHNESS_MS = 300000; // 5 mins

function computeDayPnLSymbol(
    holding: { netQty: number; multiplier: number },
    marketSession: any,
    isTradingDay: boolean,
    lastPriceData: { price: number | null; ts: number } | undefined,
    refEod: any,
    todayEod: any,
    todaysTrades: any[],
    refEodDate?: string,
    manualPriceOverride?: number,
) {
    const isRefValid = refEod?.status === 'ok' || refEod?.status === 'plan_limited' || refEod?.status === 'no_liquidity';
    const prevClose = isRefValid && refEod?.close != null ? refEod.close : undefined;

    if (prevClose === undefined) {
        return { todayPl: null, todayPlStatus: 'missing-ref-eod' };
    }

    let refPrice: number | undefined;
    let status: string = 'live';

    if (manualPriceOverride != null && Number.isFinite(manualPriceOverride)) {
        refPrice = manualPriceOverride;
        status = 'live';
    }
    else if ((todayEod?.status === 'ok' || todayEod?.status === 'plan_limited' || todayEod?.status === 'no_liquidity') && todayEod?.close != null) {
        refPrice = todayEod.close;
        status = 'closed';
    }
    else if (lastPriceData?.price != null) {
        const isStale = Date.now() - (lastPriceData.ts || 0) > FRESHNESS_MS;
        refPrice = lastPriceData.price;
        status = isStale ? 'stale-last' : 'live';
    } else {
        return { todayPl: null, todayPlStatus: 'degraded' };
    }

    if (refPrice == null || !Number.isFinite(refPrice)) {
        return { todayPl: null, todayPlStatus: status };
    }

    const { netQty, multiplier } = holding;
    const sumTradesEffect = todaysTrades.reduce((sum, tx) => {
        return sum + (tx.price - prevClose) * tx.qty;
    }, 0);

    const rawPnl = netQty * (refPrice - prevClose) - sumTradesEffect;
    const todayPl = Math.round(rawPnl * multiplier * 100) / 100;

    return { todayPl, todayPlStatus: status, refPrice, prevClose };
}

// TEST CASES
console.log("=== [E2] computeDayPnLSymbol Fallback Test ===");

const holding = { netQty: 10, multiplier: 100 };
const refEod = { symbol: 'TSLA_OPT', close: 50, status: 'ok' };
const todayEodMissing = { symbol: 'TSLA_OPT', status: 'missing' };
const realtimeMissing = { price: null, ts: 0 };

console.log("\nCase 1: Today EOD Missing + Realtime Missing + Has Ref EOD");
// Current logic: returns degraded (todayPl: null)
const res1 = computeDayPnLSymbol(holding, 'open', true, realtimeMissing, refEod, todayEodMissing, []);
console.log("Result:", JSON.stringify(res1));

console.log("\nCase 2: Realtime Stale (yesterday price) + Has Ref EOD");
// If we pass yesterday price as realtime
const res2 = computeDayPnLSymbol(holding, 'open', true, { price: 50, ts: Date.now() - 10000 }, refEod, todayEodMissing, []);
console.log("Result:", JSON.stringify(res2));

console.log("\nCase 3: Stock Regression (Stock shouldn't fallback to yesterday if RT is missing?)");
// Actually, if a stock has no RT and no Today EOD, it should also show 0 pl?
// But user said: "at least cover options".
const stockRefEod = { symbol: 'TSLA', close: 200, status: 'ok' };
const res3 = computeDayPnLSymbol({ netQty: 10, multiplier: 1 }, 'open', true, realtimeMissing, stockRefEod, todayEodMissing, []);
console.log("Result:", JSON.stringify(res3));
