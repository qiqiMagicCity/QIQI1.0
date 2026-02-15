import { Tx } from '@/hooks/use-user-transactions';
import { OfficialCloseResult } from '@/lib/data/official-close-repo';
import { toNyCalendarDayString, toNyHmsString, prevNyTradingDayString, isNyTradingDay, getMarketClosedReason, getEarlyCloseReason } from '@/lib/ny-time';
import { normalizeSymbolClient } from '@/lib/utils';
import { calcGlobalFifo } from './calc-m4-m5-2-global-fifo';
import { STOCK_SPLITS, getRestoredHistoricalPrice } from '@/lib/holdings/stock-splits';

// Local types for FIFO logic
interface FifoLayer {
    qty: number;
    price: number;
    ts: number;
    multiplier: number;
}

interface FifoState {
    longLayers: FifoLayer[];
    shortLayers: FifoLayer[];
    realizedPnl: number;
    assetType?: 'stock' | 'option';
}

import { DailyPnlStatus } from '../types/pnl-status';

export interface DailyPnlResult {
    date: string;
    totalPnl: number;
    realizedPnl: number;
    realizedPnlPosition: number; // Legacy (M4)
    realizedPnlDay: number;      // Ledger Intraday (M5.2)
    m5_1: number;                // Trading Intraday (M5.1)
    unrealizedPnlChange: number;
    eodUnrealized: number | null;
    prevEodUnrealized: number | null;
    status: DailyPnlStatus;
    missingReason?: string;
    marketClosedReason?: string;
    earlyCloseReason?: string; // [NEW] early close info
    missingSymbols?: string[];
    processedCount?: number;
}

export const ENGINE_VERSION = '4.0.0-GA';

/**
 * Helper to calculate average cost basis for a symbol.
 */
function calculateAvgCost(state: FifoState): number {
    const longQty = state.longLayers.reduce((s, l) => s + l.qty, 0);
    const shortQty = state.shortLayers.reduce((s, l) => s + l.qty, 0);
    const totalQty = longQty + shortQty;
    if (Math.abs(totalQty) < 0.000001) return 0;

    const longCost = state.longLayers.reduce((s, l) => s + l.qty * l.price, 0);
    const shortCost = state.shortLayers.reduce((s, l) => s + l.qty * l.price, 0);

    // Avg Cost = Total Money Invested / Total Qty
    return (longCost + shortCost) / totalQty;
}

/**
 * M14: Daily PnL Calendar (Total PnL)
 * Optimized Version: Rolling Calculation O(N + D*S)
 */
export function calcM14DailyCalendar(
    transactions: Tx[],
    targetDates: string[],
    eodMap: Record<string, OfficialCloseResult>,
    activeSplits: any[] = STOCK_SPLITS,
    options: { isEodLoading?: boolean } = {} // [NEW] Added options
): Record<string, DailyPnlResult> {
    const todayNy = toNyCalendarDayString(new Date());
    const now = new Date();
    const nyTimeStr = toNyHmsString(now).substring(0, 5); // Use library helper to get HH:mm
    const [hh, mm] = nyTimeStr.split(':').map(Number);
    const hhmm = hh * 100 + mm;
    const isBeforeOpen = hhmm < 930;
    const isAfterClose = hh >= 16;
    const isTradingSession = !isBeforeOpen && !isAfterClose;

    console.log(`[M14] Engine V4.0.1 Started. Today: ${todayNy} ${nyTimeStr} (Pre-market: ${isBeforeOpen}, Intraday: ${isTradingSession}, After-close: ${isAfterClose})`);
    const results: Record<string, DailyPnlResult> = {};
    if (targetDates.length === 0) return results;

    // DEBUG:EOD-TIMELINE-AUDIT
    if (typeof window !== 'undefined') {
        import('@/lib/debug/eod-timeline').then(({ audit }) => {
            if (options.isEodLoading) {
                audit("M14.calc.blocked", { reason: "eod_not_ready", eodMapSize: Object.keys(eodMap).length });
            } else {
                audit("M14.calc.start", {
                    todayNY: todayNy,
                    targetDatesCount: targetDates.length,
                    eodMapSize: Object.keys(eodMap).length,
                    has_2026_01_06_NVDA: "2026-01-06_NVDA" in eodMap,
                    has_2026_01_05_NVDA: "2026-01-05_NVDA" in eodMap,
                    has_2026_01_02_NVDA: "2026-01-02_NVDA" in eodMap,
                    txCount: transactions.length
                });
            }
        });
    }

    const isNov2025 = targetDates.some(d => d.startsWith('2025-11'));
    const sortedTxs = [...transactions].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    // 1. Pre-calculate Realized PnL (Global FIFO)
    const lastTargetDate = targetDates[targetDates.length - 1];
    const { auditTrail } = calcGlobalFifo({
        transactions,
        todayNy: lastTargetDate
    });

    const realizedPnlFullMap = new Map<string, number>();
    const realizedPnlPositionMap = new Map<string, number>();
    const realizedPnlDayMap = new Map<string, number>();

    for (const event of auditTrail) {
        const d = event.closeDate;
        realizedPnlFullMap.set(d, (realizedPnlFullMap.get(d) || 0) + event.pnl);

        if (event.openDate < d) {
            realizedPnlPositionMap.set(d, (realizedPnlPositionMap.get(d) || 0) + event.pnl);
        } else {
            realizedPnlDayMap.set(d, (realizedPnlDayMap.get(d) || 0) + event.pnl);
        }
    }

    // 1.5 Calculate M5.1 (Trading Intraday)
    const m5_1_Map = new Map<string, number>();
    const txsByDate = new Map<string, Tx[]>();
    for (const tx of sortedTxs) {
        const d = toNyCalendarDayString(tx.transactionTimestamp);
        if (!txsByDate.has(d)) txsByDate.set(d, []);
        txsByDate.get(d)!.push(tx);
    }

    for (const [date, daysTxs] of txsByDate) {
        let m5_1_val = 0;
        const queues = new Map<string, Array<{ qty: number; cost: number }>>();
        for (const tx of daysTxs) {
            const key = tx.contractKey || normalizeSymbolClient(tx.symbol);
            if (!queues.has(key)) queues.set(key, []);
            const q = queues.get(key)!;
            if (tx.opKind === 'SPLIT') continue;
            let remaining = tx.qty;
            const price = tx.price;
            const mult = tx.multiplier;
            while (Math.abs(remaining) > 0.000001) {
                if (q.length === 0) {
                    q.push({ qty: remaining, cost: price });
                    remaining = 0;
                } else {
                    const head = q[0];
                    if (Math.sign(head.qty) === Math.sign(remaining)) {
                        q.push({ qty: remaining, cost: price });
                        remaining = 0;
                    } else {
                        const matchQty = Math.min(Math.abs(remaining), Math.abs(head.qty));
                        const signedMatchQty = Math.sign(remaining) * matchQty;
                        const pnl = -signedMatchQty * (price - head.cost) * mult;
                        m5_1_val += pnl;
                        if (Math.abs(head.qty) > matchQty + 0.000001) {
                            head.qty = head.qty > 0 ? head.qty - matchQty : head.qty + matchQty;
                            remaining = remaining > 0 ? remaining - matchQty : remaining + matchQty;
                        } else {
                            q.shift();
                            remaining = remaining > 0 ? remaining - matchQty : remaining + matchQty;
                        }
                    }
                }
            }
        }
        m5_1_Map.set(date, m5_1_val);
    }

    // 2. Rolling Calculation for Unrealized PnL
    const positions = new Map<string, FifoState>();
    let txIndex = 0;
    const sortedTargetDates = [...targetDates].sort();
    let prevDateUnrealizedVal: number | null = null;
    let prevDateStatus: DailyPnlResult['status'] = 'ok';

    const getPositionState = (sym: string) => {
        const k = normalizeSymbolClient(sym);
        if (!positions.has(k)) {
            positions.set(k, { longLayers: [], shortLayers: [], realizedPnl: 0 });
        }
        return positions.get(k)!;
    };

    const lastKnownPrices = new Map<string, number>();

    const applyTxToState = (tx: Tx) => {
        if (tx.opKind === 'SPLIT') return;
        const state = getPositionState(tx.symbol);
        const assetType = tx.assetType || 'stock';
        state.assetType = assetType;
        const mult = tx.multiplier ?? (assetType === 'option' ? 100 : 1);
        if (tx.side === 'BUY') {
            let qty = tx.qty;
            while (qty > 0.000001 && state.shortLayers.length > 0) {
                const layer = state.shortLayers[0];
                const coverQty = Math.min(qty, Math.abs(layer.qty));
                layer.qty += coverQty;
                qty -= coverQty;
                if (Math.abs(layer.qty) < 0.000001) state.shortLayers.shift();
            }
            if (qty > 0.000001) {
                state.longLayers.push({ qty, price: tx.price, ts: tx.transactionTimestamp, multiplier: mult });
            }
        } else {
            let qty = Math.abs(tx.qty);
            while (qty > 0.000001 && state.longLayers.length > 0) {
                const layer = state.longLayers[0];
                const closeQty = Math.min(qty, layer.qty);
                layer.qty -= closeQty;
                qty -= closeQty;
                if (layer.qty < 0.000001) state.longLayers.shift();
            }
            if (qty > 0.000001) {
                state.shortLayers.push({ qty: -qty, price: tx.price, ts: tx.transactionTimestamp, multiplier: mult });
            }
        }
    };

    const appliedSplits = new Set<string>();
    const applyPendingSplits = (upToDate: string) => {
        for (const split of activeSplits) {
            const splitKey = `${split.effectiveDate}_${split.symbol}`;
            if (appliedSplits.has(splitKey)) continue;
            if (split.effectiveDate <= upToDate) {
                const state = positions.get(normalizeSymbolClient(split.symbol));
                if (state) {
                    const ratio = split.splitRatio;
                    if (ratio > 0) {
                        state.longLayers.forEach(l => { l.qty *= ratio; l.price /= ratio; });
                        state.shortLayers.forEach(l => { l.qty *= ratio; l.price /= ratio; });
                    }
                }
                appliedSplits.add(splitKey);
            }
        }
    };

    if (sortedTargetDates.length > 0) {
        const firstDate = sortedTargetDates[0];
        const baselineDate = prevNyTradingDayString(firstDate);
        while (txIndex < sortedTxs.length) {
            const tx = sortedTxs[txIndex];
            const txDay = toNyCalendarDayString(tx.transactionTimestamp);
            if (txDay > baselineDate) break;
            applyPendingSplits(txDay);
            applyTxToState(tx);
            txIndex++;
        }
        applyPendingSplits(baselineDate);
        if (isNyTradingDay(baselineDate)) {
            let baselineUnrealized: number | null = null;
            for (const [symKey, state] of positions) {
                const netQty = state.longLayers.reduce((s, l) => s + l.qty, 0) + state.shortLayers.reduce((s, l) => s + l.qty, 0);
                if (Math.abs(netQty) < 0.000001) continue;
                const eod = eodMap[`${baselineDate}_${symKey}`];
                const hasClose = typeof eod?.close === 'number' && Number.isFinite(eod.close);
                if (hasClose) {
                    const price = getRestoredHistoricalPrice(eod.close!, symKey, baselineDate, activeSplits);
                    let symbolPnl = 0;
                    state.longLayers.forEach(l => { symbolPnl += (price - l.price) * l.qty * l.multiplier; });
                    state.shortLayers.forEach(l => { symbolPnl += (l.price - price) * Math.abs(l.qty) * l.multiplier; });
                    baselineUnrealized = (baselineUnrealized ?? 0) + symbolPnl;
                    lastKnownPrices.set(symKey, eod.close!);
                }
            }
            prevDateUnrealizedVal = baselineUnrealized;
        }
    }

    for (const currentDate of sortedTargetDates) {
        applyPendingSplits(currentDate);
        while (txIndex < sortedTxs.length) {
            const tx = sortedTxs[txIndex];
            const txDay = toNyCalendarDayString(tx.transactionTimestamp);
            if (txDay > currentDate) break;
            applyTxToState(tx);
            txIndex++;
        }

        let eodUnrealized: number | null = null;
        let isMissing = false;
        let isEstimating = false;
        let missingReason = '';
        let marketClosedReason = '';
        const missingSymbols: string[] = [];

        if (currentDate === todayNy && isBeforeOpen) {
            // [HARD GATE]
        } else if (isNyTradingDay(currentDate)) {
            for (const [symKey, state] of positions) {
                const netQty = state.longLayers.reduce((s, l) => s + l.qty, 0) + state.shortLayers.reduce((s, l) => s + l.qty, 0);
                if (Math.abs(netQty) < 0.000001) continue;
                const eod = eodMap[`${currentDate}_${symKey}`];
                const isPlanLimited = eod?.status === 'plan_limited';
                const isNoLiquidity = eod?.status === 'no_liquidity';

                let price: number | null = null;
                let isValuable = false;

                const hasClose = typeof eod?.close === 'number' && Number.isFinite(eod.close);

                // 1. Precise Match (Now based on close abundance, not status)
                if (hasClose) {
                    price = getRestoredHistoricalPrice(eod!.close!, symKey, currentDate, activeSplits);
                    isValuable = true;
                }
                // 2. Specialized Fallback: No Liquidity (Market Close or Stale) -> Use Prev Close
                else if (isNoLiquidity) {
                    if (lastKnownPrices.has(symKey)) {
                        price = getRestoredHistoricalPrice(lastKnownPrices.get(symKey)!, symKey, currentDate, activeSplits);
                    } else {
                        price = calculateAvgCost(state);
                    }
                    isEstimating = true;
                }
                // 3. Specialized Fallback: Plan Limited (Quota Exceeded) -> Use Avg Cost
                else if (isPlanLimited) {
                    price = calculateAvgCost(state);
                    isEstimating = true;
                }
                // 4. General Fallback: Historical (already existing but truly missing today)
                else if (lastKnownPrices.has(symKey)) {
                    price = getRestoredHistoricalPrice(lastKnownPrices.get(symKey)!, symKey, currentDate, activeSplits);
                    isEstimating = true;
                }

                if (price !== null) {
                    let symbolPnl = 0;
                    state.longLayers.forEach(l => { symbolPnl += (price! - l.price) * l.qty * l.multiplier; });
                    state.shortLayers.forEach(l => { symbolPnl += (l.price - price!) * Math.abs(l.qty) * l.multiplier; });
                    eodUnrealized = (eodUnrealized ?? 0) + symbolPnl;

                    // Only update lastKnownPrices if we have a "real" close OR if it's better than nothing
                    // However, for consistency in rolling, we update it.
                    lastKnownPrices.set(symKey, price);
                } else {
                    // Truly missing: No current EOD, No History, No Plan fallback
                    missingSymbols.push(symKey);
                    isMissing = true;
                }
            }
        }

        // 2.1 Check for Truncation (Safety Shield / S1)
        const boundary = eodMap['FETCH_INCOMPLETE_BOUNDARY'];
        const truncationPoint = boundary?.meta?.lastFetchedDate;
        const isTruncated = truncationPoint && currentDate > truncationPoint;

        let status: DailyPnlResult['status'] = 'ok';

        if (isTruncated) {
            status = 'fetch_incomplete';
            isMissing = false;
            missingSymbols.length = 0; // Prevent from entering "Missing List" or triggering AutoHeal
            eodUnrealized = prevDateUnrealizedVal;
        } else if (currentDate === todayNy && isBeforeOpen) {
            status = 'not_open';
            eodUnrealized = prevDateUnrealizedVal;
        } else if (currentDate === todayNy && isTradingSession) {
            status = 'intraday';
            eodUnrealized = prevDateUnrealizedVal;
        } else if (!isNyTradingDay(currentDate)) {
            status = 'market_closed';
            marketClosedReason = getMarketClosedReason(currentDate) || '';
            eodUnrealized = prevDateUnrealizedVal;
            if (prevDateStatus === 'missing_data') {
                status = 'missing_data';
                missingReason = 'prev-eod-missing-for-holiday';
            }
        } else if (options.isEodLoading && isMissing) {
            status = 'loading_eod';
            isMissing = false;
            missingSymbols.length = 0;
            eodUnrealized = prevDateUnrealizedVal;
        } else if (isMissing) {
            status = 'missing_data';
            missingReason = 'eod-price-missing';
            eodUnrealized = prevDateUnrealizedVal;
        } else if (isEstimating) {
            status = 'partial';
            missingReason = 'eod-price-estimated';
        }

        const unrealizedPnlChange = (eodUnrealized !== null && prevDateUnrealizedVal !== null) ? (eodUnrealized - prevDateUnrealizedVal) : 0;
        const realized = realizedPnlFullMap.get(currentDate) || 0;

        results[currentDate] = {
            date: currentDate,
            totalPnl: realized + unrealizedPnlChange,
            realizedPnl: realized,
            realizedPnlPosition: realizedPnlPositionMap.get(currentDate) || 0,
            realizedPnlDay: realizedPnlDayMap.get(currentDate) || 0,
            m5_1: m5_1_Map.get(currentDate) || 0,
            unrealizedPnlChange,
            eodUnrealized,
            prevEodUnrealized: prevDateUnrealizedVal,
            status,
            missingReason: missingReason || undefined,
            marketClosedReason: marketClosedReason || undefined,
            earlyCloseReason: getEarlyCloseReason(currentDate) || undefined,
            missingSymbols: missingSymbols.length > 0 ? missingSymbols : undefined,
            processedCount: 1
        };

        prevDateUnrealizedVal = eodUnrealized;
        prevDateStatus = status;

        // DEBUG:EOD-TIMELINE-AUDIT
        if (currentDate === '2026-01-06' && typeof window !== 'undefined') {
            import('@/lib/debug/eod-timeline').then(({ audit }) => {
                audit("M14.dayResult.2026-01-06", {
                    status: results[currentDate].status,
                    missingSymbols: results[currentDate].missingSymbols
                });
            });
        }
    }

    return results;
}
