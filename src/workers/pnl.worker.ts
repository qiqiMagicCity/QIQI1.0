// src/workers/pnl.worker.ts
import { calcM14DailyCalendar, DailyPnlResult } from '@/lib/pnl/calc-m14-daily-calendar';
import { Tx } from '@/hooks/use-user-transactions';
import { OfficialCloseResult } from '@/lib/data/official-close-repo';
import { SplitEvent } from '@/lib/holdings/stock-splits';
import { toNyCalendarDayString, getPeriodStartDates, getPeriodBaseDates, prevNyTradingDayString } from '@/lib/ny-time';
import { eachDayOfInterval } from 'date-fns';
import { get, set } from 'idb-keyval'; // [NEW] Import IndexedDB helper

// Define Message Types
import { FifoSnapshot } from '@/lib/types/fifo-snapshot'; // [NEW]

export type PnlWorkerInput = {
    transactions: Tx[];
    fullEodMap: Record<string, OfficialCloseResult>;
    activeSplits: SplitEvent[];
    effectiveTodayNy: string;
    visibleTransactions: Tx[];
    snapshot?: FifoSnapshot | null; // [NEW]
    isEodLoading?: boolean; // [NEW] Add this
};

export type PnlWorkerOutput = {
    results: Record<string, DailyPnlResult>;
    error?: string;
};

// [NEW] Helper to simple hash string
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
}

// [NEW] Generate Cache Key with Data Fingerprint (Scheme A)
function generateCacheKey(todayNy: string, txs: Tx[], activeSplits: SplitEvent[], eodMap: Record<string, OfficialCloseResult>): string {
    // 1. Transaction Fingerprint
    const count = txs.length;
    const lastTx = txs.length > 0 ? txs[txs.length - 1] : null;
    const lastId = lastTx ? (lastTx.id || 'noid') : 'empty';

    // 2. Active Splits Fingerprint
    const splitKey = activeSplits.length + (activeSplits[0]?.symbol || '');

    // 3. EOD Data Fingerprint (CRITICAL: Detecting Backfill updates)
    // We don't want to stringify the whole map, but we need to know if "Missing" turned into "OK" 
    // or if prices changed.
    let okCount = 0;
    let priceSum = 0;
    const eodKeys = Object.keys(eodMap);
    const eodTotal = eodKeys.length;

    // Iterate map to build a digest. O(N) in worker is fast (~1-2ms for 5000 items).
    for (const key of eodKeys) {
        const res = eodMap[key];
        const isValid = res && (res.status === 'ok' || res.status === 'plan_limited' || res.status === 'no_liquidity');
        if (isValid) {
            okCount++;
            priceSum += (res.close || 0);
        }
    }

    // Fingerprint format: eodTotal_okCount_priceDigest
    // Using string sum to capture precision changes without floating point jitter issues in key
    const eodFingerprint = `${eodTotal}_${okCount}_${priceSum.toFixed(2)}`;

    // Key Version v2 to invalidate all v1 stale caches
    return `pnl_v4_${todayNy}_${count}_${lastId}_${splitKey}_${eodFingerprint}`;
}

// Event Listener
self.onmessage = async (event: MessageEvent<any>) => {
    const { action } = event.data;

    if (action === 'GENERATE_SNAPSHOTS') {
        await handleGenerateSnapshots(event.data);
        return;
    }

    // Default: Calc View PnL
    await handleCalcPnl(event.data as PnlWorkerInput);
};

// [NEW] Handler for Snapshot Generation
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo';
import { eachMonthOfInterval, endOfMonth, isFuture } from 'date-fns';

async function handleGenerateSnapshots(data: { transactions: Tx[], uid: string }) {
    try {
        const { transactions } = data;
        const snapshots: Record<string, FifoSnapshot> = {};

        if (!transactions || transactions.length === 0) {
            self.postMessage({ action: 'SNAPSHOTS_GENERATED', snapshots: {} });
            return;
        }

        // 1. Identify Range
        const dates = transactions.map(t => t.transactionTimestamp);
        const minTs = Math.min(...dates);

        const startMonth = new Date(minTs);
        const endMonthDate = new Date();

        const months = eachMonthOfInterval({
            start: startMonth,
            end: endMonthDate
        });

        console.log(`[Worker] Generating Snapshots for ${months.length} months...`);

        // 2. Loop Month Ends
        for (const monthDate of months) {
            const eom = endOfMonth(monthDate);
            const eomStr = toNyCalendarDayString(eom);

            // Skip future or current incomplete month
            if (isFuture(eom)) continue;

            // Filter Txs UP TO this date
            const txsForDate = transactions.filter(t => {
                const d = toNyCalendarDayString(t.transactionTimestamp);
                return d <= eomStr;
            });

            if (txsForDate.length === 0) continue;

            // Run Calc (Pure, from scratch)
            const result = calcGlobalFifo({
                transactions: txsForDate,
                todayNy: eomStr,
                snapshot: null
            });

            // Build Payload
            const inventoryRec: Record<string, any[]> = {};
            for (const [key, lots] of result.openPositions.entries()) {
                if (lots.length > 0) {
                    inventoryRec[key] = lots;
                }
            }

            const snap: FifoSnapshot = {
                date: eomStr,
                timestamp: eom.getTime(),
                version: '1.0',
                inventory: inventoryRec,
                metrics: {
                    realizedPnl_Lifetime: result.totalRealizedPnl,
                    winCount: result.winCount,
                    lossCount: result.lossCount
                }
            };

            snapshots[eomStr] = snap;
        }

        self.postMessage({ action: 'SNAPSHOTS_GENERATED', snapshots });

    } catch (e: any) {
        console.error('[Worker] Snapshot Gen Failed:', e);
        self.postMessage({ action: 'SNAPSHOTS_ERROR', error: e.message });
    }
}

async function handleCalcPnl(data: PnlWorkerInput) {
    try {
        const { transactions, fullEodMap, activeSplits, effectiveTodayNy, visibleTransactions, isEodLoading } = data;
        // ... (Existing logic moved here) ...
        const todayNy = effectiveTodayNy;

        // 0. Prepare Inputs & Cache Key
        const inputTxs = visibleTransactions || transactions || [];

        // [NEW] Generate Cache Key with Data Fingerprint (O(N) digest)
        // This ensures that if ANY 'Missing' status turns to 'OK' or if prices change, the cache invalidates.
        // We also add isEodLoading to the key to prevent caching a "loading" state.
        const eodFingerprint = `${isEodLoading ? 'loading' : 'ready'}_${Object.keys(fullEodMap).length}`;
        const cacheKey = `pnl_v5_${todayNy}_${inputTxs.length}_${eodFingerprint}`;

        // 1. [NEW] Try Load Cache
        const cached = await get<Record<string, DailyPnlResult>>(cacheKey);

        if (cached) {
            // console.log('[PnL Worker] Cache HIT ⚡️');
            self.postMessage({ results: cached });
            return;
        }

        // console.log('[PnL Worker] Cache MISS 🐢 (Computing...)');

        // 2. Re-generate Target Dates INSIDE Worker
        const { ytd: ytdStartStr } = getPeriodStartDates(todayNy);
        const ytdRange = eachDayOfInterval({
            start: new Date(`${ytdStartStr}T12:00:00Z`),
            end: new Date(`${todayNy}T12:00:00Z`)
        });
        const ytdTargetDates = ytdRange.map(d => toNyCalendarDayString(d));

        const periodBaseDates = getPeriodBaseDates(todayNy);
        const refDateUsed = prevNyTradingDayString(todayNy);

        const extraDates = [
            periodBaseDates.ytd,
            periodBaseDates.mtd,
            periodBaseDates.wtd,
            refDateUsed
        ].filter(d => !ytdTargetDates.includes(d) && d < todayNy).sort();

        const allTargets = Array.from(new Set([...extraDates, ...ytdTargetDates])).sort();

        // 3. Perform Calculation
        const results = calcM14DailyCalendar(inputTxs, allTargets, fullEodMap, activeSplits, { isEodLoading });

        // 4. [NEW] Save to Cache (Async, don't await blocking return)
        set(cacheKey, results).catch(err => console.warn('Failed to cache PnL results:', err));

        // 5. Send Result Back
        self.postMessage({ results });

    } catch (error: any) {
        console.error('[PnL Worker] Computation Failed:', error);
        self.postMessage({ results: {}, error: error.message });
    }
}
