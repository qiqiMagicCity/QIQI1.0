// src/workers/pnl.worker.ts
import { calcM14DailyCalendar, DailyPnlResult } from '@/lib/pnl/calc-m14-daily-calendar';
import { Tx } from '@/hooks/use-user-transactions';
import { OfficialCloseResult } from '@/lib/data/official-close-repo';
import { SplitEvent } from '@/lib/holdings/stock-splits';
import { toNyCalendarDayString, getPeriodStartDates, getPeriodBaseDates, prevNyTradingDayString } from '@/lib/ny-time';
import { eachDayOfInterval } from 'date-fns';
import { get, set } from 'idb-keyval'; // [NEW] Import IndexedDB helper

// Define Message Types
export type PnlWorkerInput = {
    transactions: Tx[];
    fullEodMap: Record<string, OfficialCloseResult>;
    activeSplits: SplitEvent[];
    effectiveTodayNy: string;
    visibleTransactions: Tx[];
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
self.onmessage = async (event: MessageEvent<PnlWorkerInput>) => {
    try {
        const { transactions, fullEodMap, activeSplits, effectiveTodayNy, visibleTransactions } = event.data;

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
};
