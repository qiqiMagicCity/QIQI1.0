import { Tx } from '@/hooks/use-user-transactions';
import { OfficialCloseResult } from '@/lib/data/official-close-repo';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import { toNyCalendarDayString, prevNyTradingDayString, isNyTradingDay } from '@/lib/ny-time';
import { normalizeSymbolClient } from '@/lib/utils';
import { calcGlobalFifo } from './calc-m4-m5-2-global-fifo';

export interface DailyPnlResult {
    date: string;
    totalPnl: number;
    realizedPnl: number;
    realizedPnlPosition: number; // Legacy (M4)
    realizedPnlDay: number;      // Ledger Intraday (M5.2)
    m5_1: number;                // Trading Intraday (M5.1)
    unrealizedPnlChange: number;
    eodUnrealized: number;
    prevEodUnrealized: number;
    status: 'ok' | 'partial' | 'missing-data' | 'market-closed';
    missingReason?: string;
    missingSymbols?: string[];
}

/**
 * M14: Daily PnL Calendar (Total PnL)
 */
export function calcM14DailyCalendar(
    transactions: Tx[],
    targetDates: string[],
    eodMap: Record<string, OfficialCloseResult>
): Record<string, DailyPnlResult> {
    const results: Record<string, DailyPnlResult> = {};

    // 0. Pre-group transactions by Date (for M5.1 calculation)
    const txsByDate = new Map<string, Tx[]>();
    for (const tx of transactions) {
        const d = toNyCalendarDayString(tx.transactionTimestamp);
        if (!txsByDate.has(d)) txsByDate.set(d, []);
        txsByDate.get(d)!.push(tx);
    }

    // 1. Pre-calculate Realized PnL (Global FIFO) for M4 & M5.2
    const lastTargetDate = targetDates.length > 0
        ? targetDates[targetDates.length - 1]
        : toNyCalendarDayString(Date.now());

    const { auditTrail } = calcGlobalFifo({
        transactions,
        todayNy: lastTargetDate
    });

    const realizedPnlMap = new Map<string, number>();           // Total Realized
    const realizedPnlPositionMap = new Map<string, number>();   // Legacy (Position)
    const realizedPnlDayMap = new Map<string, number>();        // Intraday (Day Trade - Ledger)

    for (const event of auditTrail) {
        const d = event.closeDate;

        // Accumulate Total
        const currentTotal = realizedPnlMap.get(d) || 0;
        realizedPnlMap.set(d, currentTotal + event.pnl);

        // Split Logic: Check Open Date vs Close Date
        if (event.openDate < d) {
            // Position PnL (Legacy): Opened before today
            const currentPos = realizedPnlPositionMap.get(d) || 0;
            realizedPnlPositionMap.set(d, currentPos + event.pnl);
        } else {
            // Day Trade PnL: Opened today (Ledger View)
            const currentDay = realizedPnlDayMap.get(d) || 0;
            realizedPnlDayMap.set(d, currentDay + event.pnl);
        }
    }

    // 1.5 Calculate M5.1 (Trading Intraday) for each relevant date
    const m5_1_Map = new Map<string, number>();

    // We only need to calc for dates that exist in transactions OR targetDates
    // But since M5.1 depends ONLY on transactions, we iterate the grouped map.
    // However, we should also cover targetDates if they have partial data (though likely 0 if no txs).
    for (const [date, daysTxs] of txsByDate) {
        // Run Intraday FIFO
        let m5_1_val = 0;
        const sortedTxs = [...daysTxs].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);
        const queues = new Map<string, Array<{ qty: number; cost: number }>>();

        for (const tx of sortedTxs) {
            const key = tx.contractKey || normalizeSymbolClient(tx.symbol); // Reusing import
            if (!queues.has(key)) queues.set(key, []);
            const q = queues.get(key)!;

            if (tx.opKind === 'SPLIT') continue; // Ignore splits for intraday PnL

            let remaining = tx.qty;
            const price = tx.price;
            const mult = tx.multiplier;

            while (remaining !== 0) {
                if (q.length === 0) {
                    q.push({ qty: remaining, cost: price });
                    remaining = 0;
                } else {
                    const head = q[0];
                    if (Math.sign(head.qty) === Math.sign(remaining)) {
                        q.push({ qty: remaining, cost: price });
                        remaining = 0;
                    } else {
                        // Match
                        const matchQty = Math.min(Math.abs(remaining), Math.abs(head.qty));
                        const signedMatchQty = Math.sign(remaining) * matchQty;

                        // PnL = -SignedMatchQty * (ExitPrice - EntryPrice) * Multiplier
                        // Wait, if I Buy 10 @ 100, Sell 10 @ 110. Remaining (Sell) = -10. Head (Buy) = 10.
                        // matchQty = 10. signedMatchQty = -10.
                        // PnL = -(-10) * (110 - 100) = 10 * 10 = 100. Correct.
                        // If Short 10 @ 100, Cover 10 @ 90. Head (Sell) = -10. Remaining (Buy) = 10.
                        // matchQty = 10. signedMatchQty = 10.
                        // PnL = -(10) * (90 - 100) = -10 * -10 = 100. Correct.

                        const pnl = -signedMatchQty * (price - head.cost) * mult;
                        m5_1_val += pnl;

                        if (Math.abs(head.qty) > matchQty) {
                            head.qty = head.qty > 0 ? head.qty - matchQty : head.qty + matchQty;
                            remaining = remaining > 0 ? remaining - matchQty : remaining + matchQty;
                        } else {
                            q.shift();
                            remaining = remaining > 0 ? remaining - matchQty : remaining + matchQty;
                        }
                        if (Math.abs(remaining) < 0.000001) remaining = 0;
                    }
                }
            }
        }
        m5_1_Map.set(date, m5_1_val);
    }

    // 2. Helper to calculate Unrealized PnL (Unchanged)
    // [UPDATE] Cache now stores missingSymbols list
    const unrealizedPnlCache = new Map<string, { val: number; status: 'ok' | 'missing' | 'market-closed'; missingReason?: string; missingSymbols?: string[] }>();

    const getUnrealizedPnl = (date: string): { val: number; status: 'ok' | 'missing' | 'market-closed'; missingReason?: string; missingSymbols?: string[] } => {
        if (unrealizedPnlCache.has(date)) return unrealizedPnlCache.get(date)!;

        // [Logic Branch 1]: Non-Trading Day
        if (!isNyTradingDay(date)) {
            const prevTradingDay = prevNyTradingDayString(date);
            const prevRes = getUnrealizedPnl(prevTradingDay);
            const res = {
                val: prevRes.val,
                status: 'market-closed' as const,
                missingReason: prevRes.status === 'missing' ? 'prev-eod-missing-for-holiday' : undefined,
                missingSymbols: undefined // [FIX] Non-trading days should NOT report missing data themselves per User Request
            };
            if (prevRes.status === 'missing') {
                (res.status as any) = 'missing';
                res.missingReason = 'prev-eod-missing-chain';
            }
            unrealizedPnlCache.set(date, res);
            return res;
        }

        // [Logic Branch 2]: Trading Day
        const txsUntilDate = transactions.filter(tx => {
            const txDay = toNyCalendarDayString(tx.transactionTimestamp);
            return txDay <= date;
        });

        const { holdings } = buildHoldingsSnapshot(txsUntilDate);

        let totalUnrealized = 0;
        let isMissing = false;
        let reason = '';
        const missingSymbols: string[] = [];

        for (const h of holdings) {
            if (Math.abs(h.netQty) < 0.000001) continue;

            const sym = normalizeSymbolClient(h.symbol);
            const key = `${date}_${sym}`;
            const eod = eodMap[key];

            // [DEBUG_CONSUMER] Trace specific lookup failures (REMOVED)

            if (eod?.status === 'ok' && typeof eod.close === 'number') {
                const pnl = (eod.close - h.costPerUnit) * h.netQty * h.multiplier;
                totalUnrealized += pnl;
            } else {
                isMissing = true;
                // Simplify: just collect missing symbols
                if (!missingSymbols.includes(sym)) missingSymbols.push(sym);

                if (!eod) reason = 'no-eod-doc';
                else if ((eod.status as string) === 'missing_vendor') reason = 'vendor-missing';
                else reason = `bad-status-${eod.status}`;

                // [DEBUG] Diagnose 'Blindness' bug: Log why we cant find data for specific symbols
                // if (process.env.NODE_ENV === 'development') {
                //      console.warn(`[CalcM14] Missing EOD for ${sym} on ${date}. Key="${key}". InMap?=${key in eodMap}. Status=${eod?.status}, Close=${eod?.close}`);
                // }
            }
        }


        const res = {
            val: isMissing ? 0 : totalUnrealized,
            status: isMissing ? 'missing' as const : 'ok' as const,
            missingReason: isMissing ? reason : undefined,
            missingSymbols: isMissing ? missingSymbols : undefined
        };
        unrealizedPnlCache.set(date, res);
        return res;
    };

    // 3. Compute M14 for each target date
    for (const date of targetDates) {
        const realized = realizedPnlMap.get(date) || 0;
        const currentRes = getUnrealizedPnl(date);
        const prevBaseDate = prevNyTradingDayString(date);
        const prevRes = getUnrealizedPnl(prevBaseDate);

        let status: DailyPnlResult['status'] = 'ok';
        let missingReason: string | undefined;

        if (currentRes.status === 'market-closed') {
            status = 'market-closed';
        } else if (currentRes.status === 'missing') {
            status = 'missing-data';
            missingReason = `today-missing: ${currentRes.missingReason}`;
        } else if (prevRes.status === 'missing') {
            status = 'missing-data';
            missingReason = `prev-eod-missing`;
        } else {
            status = 'ok';
        }

        const unrealizedChange = currentRes.val - prevRes.val;
        const totalPnl = realized + unrealizedChange;

        const currentRealizedPos = realizedPnlPositionMap.get(date) || 0;
        const currentRealizedDay = realizedPnlDayMap.get(date) || 0;
        const m5_1 = m5_1_Map.get(date) || 0;

        results[date] = {
            date,
            totalPnl,
            realizedPnl: realized,
            realizedPnlPosition: currentRealizedPos,
            realizedPnlDay: currentRealizedDay,
            m5_1,
            unrealizedPnlChange: unrealizedChange,
            eodUnrealized: currentRes.val,
            prevEodUnrealized: prevRes.val,
            status,
            missingReason,
            missingSymbols: status === 'missing-data' ? (currentRes.missingSymbols || prevRes.missingSymbols) : undefined
        };
    }

    return results;
}
