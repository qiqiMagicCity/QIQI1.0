import { Tx } from '@/hooks/use-user-transactions';
import { OfficialCloseResult } from '@/lib/data/official-close-repo';
import { toNyCalendarDayString, prevNyTradingDayString, isNyTradingDay } from '@/lib/ny-time';
import { normalizeSymbolClient } from '@/lib/utils';
import { calcGlobalFifo } from './calc-m4-m5-2-global-fifo';
import { STOCK_SPLITS, getRestoredHistoricalPrice } from '@/lib/holdings/stock-splits';

// Local types for FIFO logic
interface FifoLayer {
    qty: number;
    price: number;
    ts: number;
    multiplier: number; // [FIX] Precision: Store multiplier explicitly per layer
}

interface FifoState {
    longLayers: FifoLayer[];
    shortLayers: FifoLayer[];
    realizedPnl: number;
}

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
 * Optimized Version: Rolling Calculation O(N + D*S)
 */
export function calcM14DailyCalendar(
    transactions: Tx[],
    targetDates: string[],
    eodMap: Record<string, OfficialCloseResult>
): Record<string, DailyPnlResult> {
    const results: Record<string, DailyPnlResult> = {};
    if (targetDates.length === 0) return results;

    // 0. Pre-process Data
    const isNov2025 = targetDates.some(d => d.startsWith('2025-11')); // [DEBUG] Detect Nov 2025 early
    // Sort transactions by time
    const sortedTxs = [...transactions].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    // Group Splits for fast lookup
    const splitsByDate = new Map<string, typeof STOCK_SPLITS>();
    for (const split of STOCK_SPLITS) {
        if (!split.effectiveDate) continue;
        const d = split.effectiveDate;
        if (!splitsByDate.has(d)) splitsByDate.set(d, []);
        splitsByDate.get(d)!.push(split);
    }

    // 1. Pre-calculate Realized PnL (Global FIFO)
    const lastTargetDate = targetDates[targetDates.length - 1];
    const { auditTrail } = calcGlobalFifo({
        transactions,
        todayNy: lastTargetDate
    });

    const realizedPnlFullMap = new Map<string, number>();           // Total Realized
    const realizedPnlPositionMap = new Map<string, number>();   // Legacy (Position)
    const realizedPnlDayMap = new Map<string, number>();        // Intraday (Day Trade - Ledger)

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

    // Sort targetDates to ensure chronological order
    const sortedTargetDates = [...targetDates].sort();

    // Cache previous date's result
    let prevDateUnrealizedVal = 0;
    let prevDateStatus: DailyPnlResult['status'] = 'ok';
    let prevDateMissingSymbols: string[] | undefined = undefined;

    const getPositionState = (sym: string) => {
        const k = normalizeSymbolClient(sym);
        if (!positions.has(k)) {
            positions.set(k, { longLayers: [], shortLayers: [], realizedPnl: 0 });
        }
        return positions.get(k)!;
    };

    // Cache last known prices to handle missing data gracefully
    const lastKnownPrices = new Map<string, number>();

    // --- Helper: Apply Tx to Position State ---
    const applyTxToState = (tx: Tx) => {
        if (tx.opKind === 'SPLIT') return;

        const state = getPositionState(tx.symbol);
        const assetType = tx.assetType || 'stock';
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

    // --- Warmup Phase: Initialize Baseline State ---
    // Fast-forward to the day *before* the first target date to set correct prevDateUnrealizedVal
    if (sortedTargetDates.length > 0) {
        const firstDate = sortedTargetDates[0];
        const baselineDate = prevNyTradingDayString(firstDate);

        // Fast-forward transactions
        while (txIndex < sortedTxs.length) {
            const tx = sortedTxs[txIndex];
            const txDay = toNyCalendarDayString(tx.transactionTimestamp);
            if (txDay > baselineDate) break;

            applyTxToState(tx);
            txIndex++;
        }

        // Calculate Baseline Unrealized PnL (if valid trading day)
        // We rely on eodMap containing data for baselineDate (useDailyPnl fetches prevMonthEnd)
        if (isNyTradingDay(baselineDate)) {
            // [DEBUG] Container for Oct 31 (Baseline) analysis
            const debugHoldings: any[] = [];

            for (const [symKey, state] of positions) {
                const netQty = state.longLayers.reduce((s, l) => s + l.qty, 0) +
                    state.shortLayers.reduce((s, l) => s + l.qty, 0);

                if (Math.abs(netQty) < 0.000001) continue;

                const key = `${baselineDate}_${symKey}`;
                const eod = eodMap[key];

                let priceUsed = 'MISSING';

                // Only use high-quality EOD for baseline to avoid skewing start
                if (eod?.status === 'ok' && typeof eod.close === 'number') {
                    // [STANDARD] Use standardized price restoration
                    const price = getRestoredHistoricalPrice(eod.close, symKey, baselineDate);

                    priceUsed = price.toFixed(2);
                    state.longLayers.forEach(l => {
                        prevDateUnrealizedVal += (price - l.price) * l.qty * l.multiplier;
                    });
                    state.shortLayers.forEach(l => {
                        prevDateUnrealizedVal += (l.price - price) * Math.abs(l.qty) * l.multiplier;
                    });
                    // Also seed lastKnownPrices with RAW Adjusted Close (normalized to current)
                    lastKnownPrices.set(symKey, eod.close);
                }

                // [DEBUG] Collect info
                if (isNov2025) {
                    debugHoldings.push({
                        Symbol: symKey,
                        NetQty: netQty.toFixed(4),
                        PriceOct31: priceUsed
                    });
                }
            }

            // [DEBUG] Print Table
            if (isNov2025 && debugHoldings.length > 0) {
                console.groupCollapsed(`🔍 WARMUP CHECK (${baselineDate})`);
                console.log('Verifying if we have valid prices for held positions...');
                console.table(debugHoldings);
                if (debugHoldings.some(h => h.PriceOct31 === 'MISSING')) {
                    console.error('❌ CRITICAL: Missing EOD data for baseline! Unrealized Start will be wrong (0).');
                } else {
                    console.log('✅ Baseline prices look good.');
                }
                console.groupEnd();
            }
        }
    }

    for (let i = 0; i < sortedTargetDates.length; i++) {
        const currentDate = sortedTargetDates[i];
        const prevDate = i > 0 ? sortedTargetDates[i - 1] : '';

        // 2.1 Identify Splits in Gap
        if (splitsByDate.size > 0) {
            for (const [splitDate, events] of splitsByDate) {
                if (splitDate > prevDate && splitDate <= currentDate) {
                    for (const split of events) {
                        const state = positions.get(normalizeSymbolClient(split.symbol));
                        if (state) {
                            const ratio = split.splitRatio;
                            if (ratio > 0) {
                                state.longLayers.forEach(l => {
                                    l.qty = l.qty * ratio;
                                    l.price = l.price / ratio;
                                });
                                state.shortLayers.forEach(l => {
                                    l.qty = l.qty * ratio;
                                    l.price = l.price / ratio;
                                });
                            }
                        }
                    }
                }
            }
        }

        // 2.2 Process Transactions for the Current Date
        while (txIndex < sortedTxs.length) {
            const tx = sortedTxs[txIndex];
            const txDay = toNyCalendarDayString(tx.transactionTimestamp);

            if (txDay > currentDate) {
                break;
            }

            // Apply Tx
            applyTxToState(tx);

            txIndex++;
        }

        // 2.3 Calculate EOD Unrealized PnL
        let eodUnrealized = 0;
        let isMissing = false;
        let isEstimating = false; // [NEW] Flag for fallback usage
        let missingReason = '';
        const missingSymbols: string[] = [];

        if (!isNyTradingDay(currentDate)) {
            eodUnrealized = prevDateUnrealizedVal;
            if (prevDateStatus === 'missing-data') {
                isMissing = true;
                missingReason = 'prev-eod-missing-for-holiday';
            } else {
                isMissing = false;
            }

        } else {
            // Trading Day: Calculate from Positions
            for (const [symKey, state] of positions) {
                const netQty =
                    state.longLayers.reduce((s, l) => s + l.qty, 0) +
                    state.shortLayers.reduce((s, l) => s + l.qty, 0);

                if (Math.abs(netQty) < 0.000001) continue;

                const key = `${currentDate}_${symKey}`;
                let eod = eodMap[key];
                let price = 0;
                let priceSource: 'live' | 'fallback' = 'live';

                if (eod?.status === 'ok' && typeof eod.close === 'number') {
                    // [STANDARD] Use standardized price restoration
                    price = getRestoredHistoricalPrice(eod.close, symKey, currentDate);
                    lastKnownPrices.set(symKey, eod.close); // Cache RAW EOD
                } else {
                    // Fallback Strategy: Use last known RAW price AND restore it
                    if (lastKnownPrices.has(symKey)) {
                        const rawPrice = lastKnownPrices.get(symKey)!;
                        price = getRestoredHistoricalPrice(rawPrice, symKey, currentDate);
                        priceSource = 'fallback';
                        isEstimating = true;
                    } else {
                        // No live data and no fallback, this symbol is truly missing
                        missingSymbols.push(symKey);
                        isMissing = true;
                        continue; // Skip PnL calculation for this symbol
                    }
                }

                // Calculate PnL if a valid price is found
                if (price > 0) {
                    // Long layers
                    for (const layer of state.longLayers) {
                        eodUnrealized += (price - layer.price) * layer.qty * layer.multiplier;
                    }
                    // Short layers
                    for (const layer of state.shortLayers) {
                        eodUnrealized += (layer.price - price) * Math.abs(layer.qty) * layer.multiplier;
                    }
                }
            }
        }

        // 2.4 Assemble Result
        let status: DailyPnlResult['status'] = 'ok';
        if (isMissing) {
            status = 'missing-data';
            missingReason = 'eod-price-missing';
        } else if (isEstimating) {
            status = 'partial'; // Use 'partial' if some prices were estimated
            missingReason = 'eod-price-estimated';
        } else if (!isNyTradingDay(currentDate)) {
            status = 'market-closed';
        }

        const unrealizedPnlChange = eodUnrealized - prevDateUnrealizedVal;
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
            missingReason: isMissing ? missingReason : undefined,
            missingSymbols: isMissing ? missingSymbols : undefined
        };

        // Update Cache
        prevDateUnrealizedVal = eodUnrealized;
        prevDateStatus = status;
        prevDateMissingSymbols = missingSymbols;
    }

    // --- 🔍 FORENSIC AUDIT: NOV 2025 ---
    // isNov2025 is already defined at top of function
    if (isNov2025) {
        console.group('%c🔍 NOV 2025 FORENSIC PnL AUDIT', 'color: yellow; font-weight: bold; font-size: 14px;');

        // 1. Realized Analysis
        const novTxs = auditTrail.filter(e => e.closeDate.startsWith('2025-11'));
        const novRealizedTotal = novTxs.reduce((sum, e) => sum + e.pnl, 0);

        console.log(`%c1. Realized PnL: $${novRealizedTotal.toFixed(2)}`, 'font-weight: bold');
        if (novTxs.length > 0) {
            console.table(novTxs.map(e => ({
                Date: e.closeDate,
                Sym: e.symbol,
                Qty: e.qty.toFixed(2),
                'Sell $': e.closePrice.toFixed(2),
                'Cost $': e.openPrice.toFixed(2),
                'PnL': e.pnl.toFixed(2)
            })));
        } else {
            console.log('(No realized gains/losses in Nov)');
        }

        // 2. Unrealized Analysis
        // Find Nov 30 result (or last day)
        const sorted = Object.keys(results).sort();
        const lastDay = sorted[sorted.length - 1];
        const lastRes = results[lastDay];

        // Find Start Value (captured in Warmup Phase as prevDateUnrealizedVal before loop started, 
        // but now prevDateUnrealizedVal is at END of loop. We need the START.)
        // Actually, for Nov 1 entry, `prevEodUnrealized` holds the Oct 31 val.
        const firstDay = sorted[0];
        const firstRes = results[firstDay];
        const startUnrealized = firstRes?.prevEodUnrealized || 0;
        const endUnrealized = lastRes?.eodUnrealized || 0;
        const unrealizedChange = endUnrealized - startUnrealized;

        console.log(`%c2. Unrealized Change: $${unrealizedChange.toFixed(2)}`, 'font-weight: bold');
        console.log(`   Oct 31 Value: $${startUnrealized.toFixed(2)}`);
        console.log(`   Nov 30 Value: $${endUnrealized.toFixed(2)}`);

        // 3. Verdict
        const totalCalc = novRealizedTotal + unrealizedChange;

        console.log(`%c3. VERDICT (Total PnL): $${totalCalc.toFixed(2)}`, 'color: cyan; font-weight: bold; font-size: 16px;');
        console.log('--------------------------------------------------');
        console.groupEnd();
    }

    return results;
}
