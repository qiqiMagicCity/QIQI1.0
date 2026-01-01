import { Tx } from '@/hooks/use-user-transactions';
import { OfficialCloseResult } from '@/lib/data/official-close-repo';
import { toNyCalendarDayString, prevNyTradingDayString, isNyTradingDay } from '@/lib/ny-time';
import { normalizeSymbolClient } from '@/lib/utils';
import { calcGlobalFifo } from './calc-m4-m5-2-global-fifo';
import { STOCK_SPLITS, getRestoredHistoricalPrice } from '@/lib/holdings/stock-splits';

// Helper to get split ratio if a split occurred ON the target date
function getSplitRatioOnDate(symbol: string, date: string): number {
    const normSym = normalizeSymbolClient(symbol);
    const split = STOCK_SPLITS.find(s =>
        normalizeSymbolClient(s.symbol) === normSym &&
        s.effectiveDate === date
    );
    return split ? split.splitRatio : 1;
}

export interface AttributionItem {
    symbol: string;
    qty: number;
    startPrice: number | 'MISSING';
    endPrice: number | 'MISSING';
    pnlImpact: number;
    type: 'HOLDING' | 'INTRADAY_ACTIVITY';
    desc: string;
}

export interface DailyAttributionResult {
    date: string;
    realizedItems: { symbol: string; pnl: number; desc: string }[];
    unrealizedItems: AttributionItem[];
    totalUnrealizedChange: number;
    totalRealized: number;
}

/**
 * Calculates the granular breakdown of PnL for a SINGLE specific date.
 * Re-runs the rolling loop up to that date to ensure state accuracy.
 */
export function calcDailyAttribution(
    targetDate: string,
    transactions: Tx[],
    eodMap: Record<string, OfficialCloseResult>
): DailyAttributionResult {
    // 1. Setup
    const prevDate = prevNyTradingDayString(targetDate);
    const sortedTxs = [...transactions].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    // 2. Build State up to Prev Date (EOD)
    // We need the portfolio state at EOD of prevDate to calculate "Start Value"
    const positions = new Map<string, { longLayers: any[]; shortLayers: any[] }>();

    const getPositionState = (sym: string) => {
        const k = normalizeSymbolClient(sym);
        if (!positions.has(k)) positions.set(k, { longLayers: [], shortLayers: [] });
        return positions.get(k)!;
    };

    const applyTx = (tx: Tx, state: any) => {
        if (tx.opKind === 'SPLIT') return;
        const mult = tx.multiplier || 1;

        if (tx.side === 'BUY') {
            let qty = tx.qty;

            // 1. Cover Short Layers (Legacy Short or New Short)
            while (qty > 0.000001 && state.shortLayers.length > 0) {
                const layer = state.shortLayers[0];
                const coverQty = Math.min(qty, Math.abs(layer.qty));

                // Note: Realized PnL is tracked in 'calcGlobalFifo', here we just update POSITION state 
                // to correctly reflect "Remaining Quantities" for Unrealized calc.

                layer.qty += coverQty; // Short is negative, adding positive moves to 0
                qty -= coverQty;

                if (Math.abs(layer.qty) < 0.000001) state.shortLayers.shift();
            }

            // 2. Open Long Layer (Only if qty remains)
            if (qty > 0.000001) {
                state.longLayers.push({ qty, price: tx.price, multiplier: mult });
            }
        } else {
            // SELL Side
            let qty = Math.abs(tx.qty);

            // 1. Close Long Layers (Legacy Long or New Long)
            while (qty > 0.000001 && state.longLayers.length > 0) {
                const layer = state.longLayers[0];
                const closeQty = Math.min(qty, layer.qty);

                layer.qty -= closeQty;
                qty -= closeQty;

                if (layer.qty < 0.000001) state.longLayers.shift();
            }

            // 2. Open Short Layer (Only if qty remains - Selling Short)
            if (qty > 0.000001) {
                state.shortLayers.push({ qty: -qty, price: tx.price, multiplier: mult });
            }
        }
    };

    // Fast-forward to Prev Date EOD
    let txIndex = 0;
    // [FIX] Group Splits for state reconstruction
    const splitsByDate = new Map<string, typeof STOCK_SPLITS>();
    for (const split of STOCK_SPLITS) {
        if (!split.effectiveDate) continue;
        const d = split.effectiveDate;
        if (!splitsByDate.has(d)) splitsByDate.set(d, []);
        splitsByDate.get(d)!.push(split);
    }

    let currentReplayDate = '';

    // We need to advance day by day to apply splits correctly between transactions
    // Or simpler: Check if tx date crosses a split date.

    while (txIndex < sortedTxs.length) {
        const tx = sortedTxs[txIndex];
        const txDay = toNyCalendarDayString(tx.transactionTimestamp);

        if (txDay > prevDate) break; // Stop before target date

        // Check for splits if we moved to a new day (or simpler, check if any split happened up to txDay)
        // Correct approach: When moving from currentReplayDate to txDay, apply any splits in (currentReplayDate, txDay]
        // But since transactions are sorted, we can just check if txDay has splits that haven't been applied? 
        // No, splits happen at start of day. Txs happen intraday. 
        // So apply split for 'txDay' BEFORE processing txs of 'txDay'.
        // But we must ensure we don't apply it twice.

        if (txDay !== currentReplayDate) {
            // We jumped to a new day (or the first day). 
            // We should apply splits for all days from (currentReplayDate+1) to txDay.
            // However, simple optimization: Just check if we haven't processed 'txDay' splits yet.
            // Assuming we process strictly in order.

            // Apply splits for 'txDay' if NOT yet applied? 
            // Actually, we need to apply splits for every day in the gap. 
            // But since we only care about positions for Txs, and positions don't change in empty gap days EXCEPT by splits.
            // We can just iterate the gap.

            if (currentReplayDate < txDay) {
                // Find all split dates > currentReplayDate and <= txDay
                // If currentReplayDate is empty, it's start of time.

                // Optimized: Check splitsByDate
                for (const [sDate, sEvents] of splitsByDate) {
                    if ((currentReplayDate === '' || sDate > currentReplayDate) && sDate <= txDay) {
                        for (const split of sEvents) {
                            const state = positions.get(normalizeSymbolClient(split.symbol));
                            if (state) {
                                const ratio = split.splitRatio;
                                if (ratio > 0) {
                                    state.longLayers.forEach((l: any) => {
                                        l.qty = l.qty * ratio;
                                        l.price = l.price / ratio;
                                    });
                                    state.shortLayers.forEach((l: any) => {
                                        l.qty = l.qty * ratio;
                                        l.price = l.price / ratio;
                                    });
                                }
                            }
                        }
                    }
                }
            }
            currentReplayDate = txDay;
        }

        applyTx(tx, getPositionState(tx.symbol));
        txIndex++;
    }

    // Capture "Start" State (Prev EOD)
    const startSnapshots = new Map<string, { netQty: number; price: number; unrealized: number }>();
    let prevTotalUnrealized = 0;

    for (const [sym, state] of positions) {
        const netQty = state.longLayers.reduce((s: number, l: any) => s + l.qty, 0) +
            state.shortLayers.reduce((s: number, l: any) => s + l.qty, 0);

        if (Math.abs(netQty) < 0.000001) continue;

        const key = `${prevDate}_${sym}`;
        const eod = eodMap[key];
        // [STANDARD] Apply Restored Price
        const price = (eod?.status === 'ok' && eod.close) ? getRestoredHistoricalPrice(eod.close, sym, prevDate) : 0;

        let u = 0;
        if (price > 0) {
            state.longLayers.forEach((l: any) => { u += (price - l.price) * l.qty * l.multiplier; });
            state.shortLayers.forEach((l: any) => { u += (l.price - price) * Math.abs(l.qty) * l.multiplier; });
        }

        // [FIX] Detect if a split happened TODAY (targetDate). 
        // If so, the "Prev EOD" state we just captured is in OLD shares.
        // We must convert it to NEW shares so the "Start Unrealized" is comparable to "End Unrealized".
        // (Unrealized $ Amount stays same, but Qty increases and Price decreases).
        // Actually, for PnL Change = (EndU - StartU), we just need StartU to be correct in $.
        // BUT, for the UI display (StartPrice, Qty), we probably want to show the POST-SPLIT equivalent basis?
        // Let's stick to the math first: StartU is StartU. 
        // If split happens:
        //   Day T-1: 1 share @ $100. Cost $50. U = $50.
        //   Day T (Split 2:1): 2 shares @ $50. Cost $25. U = $50.
        //   Change is $0. Correct.
        //   However, if we display "Qty: 1" and "Price: 100", it might look confusing if Day T end is "Price: 50".
        //   Let's adjust display values (Qty, Price) if split happens.

        let displayQty = netQty;
        let displayPrice = price;

        const splitRatio = getSplitRatioOnDate(sym, targetDate);
        if (splitRatio > 1) {
            displayQty = netQty * splitRatio;
            displayPrice = price / splitRatio;
            // Note: 'unrealized' ($) does not change by split itself.
        }

        prevTotalUnrealized += u;
        startSnapshots.set(sym, { netQty: displayQty, price: displayPrice, unrealized: u });
    }

    // 3. [NEW] Apply Splits Occurring Today (Before Processing Today's Txs)
    // If a split becomes effective today, the "Prev EOD" positions need to be adjusted 
    // to the new basis so they match the incoming "Post-Split" market data and transactions.
    for (const [sym, state] of positions) {
        const splitRatio = getSplitRatioOnDate(sym, targetDate);
        if (splitRatio > 1) {
            state.longLayers.forEach((l: any) => {
                l.qty = l.qty * splitRatio;
                l.price = l.price / splitRatio;
            });
            state.shortLayers.forEach((l: any) => {
                l.qty = l.qty * splitRatio;
                l.price = l.price / splitRatio;
            });
        }
    }

    // 4. Process Target Date Txs
    const realizedItems: { symbol: string; pnl: number; desc: string }[] = [];
    let dailyRealizedTotal = 0;

    // Use calcGlobalFifo for precise Realized PnL on this day
    const { auditTrail } = calcGlobalFifo({ transactions, todayNy: targetDate });
    const targetRealizedEvents = auditTrail.filter(e => e.closeDate === targetDate);

    targetRealizedEvents.forEach(e => {
        dailyRealizedTotal += e.pnl;
        realizedItems.push({
            symbol: e.symbol,
            pnl: e.pnl,
            desc: `Closed ${e.qty.toFixed(4)}`
        });
    });

    // Advance state to Target Date EOD
    // Note: calcGlobalFifo logic is parallel, here we update 'positions' state for Unrealized calc
    while (txIndex < sortedTxs.length) {
        const tx = sortedTxs[txIndex];
        const txDay = toNyCalendarDayString(tx.transactionTimestamp);
        if (txDay > targetDate) break;

        applyTx(tx, getPositionState(tx.symbol));
        txIndex++;
    }

    // 5. Calculate End State & Attribution
    const unrealizedItems: AttributionItem[] = [];
    let currTotalUnrealized = 0;
    const processedSymbols = new Set<string>();

    for (const [sym, state] of positions) {
        processedSymbols.add(sym);
        const netQty = state.longLayers.reduce((s: number, l: any) => s + l.qty, 0) +
            state.shortLayers.reduce((s: number, l: any) => s + l.qty, 0);

        // Even if netQty is 0, we might have had a position yesterday that closed today.
        // We need to account for its "Unrealized Change" contribution (which is: PnL realized - (PrevUnrealized)).
        // Wait, M14 formula: Change = EOD_U - Prev_U.
        // If position closed: EOD_U = 0. Prev_U = X. Change = -X.
        // Realized PnL = Y.
        // Total PnL = Y - X.

        const key = `${targetDate}_${sym}`;
        const eod = eodMap[key];
        // [STANDARD] Apply Restored Price
        const endPrice = (eod?.status === 'ok' && eod.close) ? getRestoredHistoricalPrice(eod.close, sym, targetDate) : 0;

        let u = 0;
        if (endPrice > 0) {
            state.longLayers.forEach((l: any) => { u += (endPrice - l.price) * l.qty * l.multiplier; });
            state.shortLayers.forEach((l: any) => { u += (l.price - endPrice) * Math.abs(l.qty) * l.multiplier; });
        }
        currTotalUnrealized += u;

        const snap = startSnapshots.get(sym);
        const startU = snap ? snap.unrealized : 0;
        const change = u - startU;

        if (Math.abs(change) > 0.01) {
            unrealizedItems.push({
                symbol: sym,
                qty: netQty, // Current Qty
                startPrice: snap ? snap.price : 'MISSING',
                endPrice: endPrice || 'MISSING',
                pnlImpact: change,
                type: 'HOLDING',
                desc: `Unrealized Change: ${startU.toFixed(0)} -> ${u.toFixed(0)}`
            });
        }
    }

    // Check for symbols that existed yesterday but are gone (fully closed)
    for (const [sym, snap] of startSnapshots) {
        if (!processedSymbols.has(sym)) {
            // It wasn't in the loop? Means it has no layers left?
            // If positions map entry exists but empty, it was in loop.
            // If it's missing from loop, it means netQty was 0 AND my loop iterator skipped it?
            // My loop iterates `positions`. `positions` entries are never deleted, just emptied.
            // So it should be handled above with netQty=0 => u=0.
            // But I put `if (Math.abs(netQty) < 0.000001) continue;` in the loop above.
            // So fully closed positions are skipped in the "Curr" loop.

            // Handle specific case: Fully Closed Position
            // EOD U = 0. Prev U = snap.unrealized. Change = -snap.unrealized.
            const change = 0 - snap.unrealized;
            if (Math.abs(change) > 0.01) {
                unrealizedItems.push({
                    symbol: sym,
                    qty: 0,
                    startPrice: snap.price,
                    endPrice: 0, // Closed
                    pnlImpact: change,
                    type: 'HOLDING', // Actually "Closed"
                    desc: `Position Closed (Prev Unrealized: ${snap.unrealized.toFixed(0)} -> 0)`
                });
            }
        }
    }

    // Sort items by ABSOLUTE magnitude of impact (descending)
    // This ensures both big winners AND big losers are visible at the top, explaining the net change best.
    unrealizedItems.sort((a, b) => Math.abs(b.pnlImpact) - Math.abs(a.pnlImpact));

    return {
        date: targetDate,
        realizedItems,
        unrealizedItems,
        totalUnrealizedChange: currTotalUnrealized - prevTotalUnrealized,
        totalRealized: dailyRealizedTotal
    };
}
