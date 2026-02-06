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

// [NEW] Generate Cache Key
function generateCacheKey(todayNy: string, txs: Tx[], activeSplits: SplitEvent[]): string {
    // 1. Transaction Fingerprint (Count + Last ID + Sum of Timestamps to capture modification)
    // Note: To be absolutely robust, we should JSON.stringify, but for performance, we compromise.
    // Let's use: Count + ID of last Tx + Last Updated Timestamp of Data

    // Sort slightly to ensure deterministic if array order changes (though provider should be stable)
    // Actually provider array reference changes often, but content is same.
    // Let's trust inputTxs length + last tx id.
    const count = txs.length;
    const lastTx = txs.length > 0 ? txs[txs.length - 1] : null;
    const lastId = lastTx ? (lastTx.id || 'noid') : 'empty';

    // 2. Active Splits Fingerprint
    const splitKey = activeSplits.length + (activeSplits[0]?.symbol || '');

    // 3. Eod Map Version? 
    // EOD map changes daily. If we use EOD map in hash, it invalidates daily. Which is expected.
    // Because M14 depends on EOD prices. If EOD price updates, PnL must update.
    // So cache is valid ONLY if Price Data hasn't changed.

    // However, stringifying fullEodMap is expensive (O(N)).
    // Strategy: We assume cache is valid for "Session". 
    // Or we use a lightweight version.

    // Let's stick to Today + Tx Signature.
    // If today is Sunday, and we open app, we compute. Then refresh, we load cache.
    // If we update EOD, `fullEodMap` changes. 
    // Ideally we'd salt with EOD Map version, but lacking that, we might miss price updates if we rely only on Tx.
    // BUT: The objective is to speed up "Refresh". EOD map usually doesn't change every second unless Live.
    // Let's assume input to Worker changes reference if data changes.
    // We can use a simpler approach:

    // Cache Key = `pnl_v1_${todayNy}_${count}_${lastId}`
    // If user adds a transaction, count/lastId changes -> Cache Miss.
    // If day rolls over, todayNy changes -> Cache Miss.
    // What if EOD updates?
    // We can add a simple EOD count to key.

    return `pnl_v1_${todayNy}_${count}_${lastId}_${splitKey}`;
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
        const { transactions, fullEodMap, activeSplits, effectiveTodayNy, visibleTransactions } = data;
        // ... (Existing logic moved here) ...
        const todayNy = effectiveTodayNy;

        // 0. Prepare Inputs & Cache Key
        const inputTxs = visibleTransactions || transactions || [];

        // [NEW] Generate Cache Key
        // Including Object.keys(fullEodMap).length to invalidate if more prices come in
        const eodCount = Object.keys(fullEodMap).length;
        const cacheKey = generateCacheKey(todayNy, inputTxs, activeSplits) + `_${eodCount}`;

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
        const results = calcM14DailyCalendar(inputTxs, allTargets, fullEodMap, activeSplits);

        // 4. [NEW] Save to Cache (Async, don't await blocking return)
        set(cacheKey, results).catch(err => console.warn('Failed to cache PnL results:', err));

        // 5. Send Result Back
        self.postMessage({ results });

    } catch (error: any) {
        console.error('[PnL Worker] Computation Failed:', error);
        self.postMessage({ results: {}, error: error.message });
    }
}
