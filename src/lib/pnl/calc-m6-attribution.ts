import { Tx } from '@/hooks/use-user-transactions';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import { toNyCalendarDayString } from '@/lib/ny-time';

export interface M6AttributionResult {
    m6_1_realized: number;
    m6_2_realized: number;
    remainingLegacyQty: number;
    remainingNewBatches: { qty: number; price: number }[];
    multiplier: number;
    status: 'ok' | 'missing_prev_close';
}

/**
 * Calculates M6.1 (Legacy PnL) and M6.2 (New PnL) attribution components.
 * 
 * M6.1 Legacy PnL = Legacy Realized + Legacy Unrealized
 *   - Legacy Realized: Sold Legacy Qty * (Exit Price - Prev Close)
 *   - Legacy Unrealized: Remaining Legacy Qty * (Current Price - Prev Close)
 * 
 * M6.2 New PnL = New Realized + New Unrealized
 *   - New Realized: Sold New Qty * (Exit Price - Entry Price)
 *   - New Unrealized: Remaining New Qty * (Current Price - Entry Price)
 * 
 * This function returns the "Realized" parts and the "Remaining Quantities" (with cost basis for New).
 * The "Unrealized" parts must be calculated by the caller using the latest Realtime Price.
 */
export function calcM6Attribution(
    transactions: Tx[],
    todayNy: string,
    prevCloseMap: Record<string, { close?: number | null; status: string } | undefined>
): Record<string, M6AttributionResult> {
    const results: Record<string, M6AttributionResult> = {};

    // 1. Split transactions into History (Overnight) and Today
    const txsBeforeToday: Tx[] = [];
    const txsToday: Tx[] = [];

    for (const tx of transactions) {
        const txDay = toNyCalendarDayString(tx.transactionTimestamp);
        if (txDay < todayNy) {
            txsBeforeToday.push(tx);
        } else if (txDay === todayNy) {
            txsToday.push(tx);
        }
    }

    // 2. Build Overnight Snapshot to get Legacy Positions
    const { holdings: overnightHoldings } = buildHoldingsSnapshot(txsBeforeToday);
    const legacyMap = new Map<string, { qty: number; multiplier: number }>();

    for (const h of overnightHoldings) {
        if (h.netQty !== 0) {
            // Normalize symbol
            const symbol = h.symbol.toUpperCase();
            legacyMap.set(symbol, { qty: h.netQty, multiplier: h.multiplier });
        }
    }

    // 3. Identify all symbols involved (Legacy + Today)
    const allSymbols = new Set<string>([
        ...Array.from(legacyMap.keys()),
        ...txsToday.map(t => t.symbol.toUpperCase())
    ]);

    // 4. Process each symbol
    for (const symbol of allSymbols) {
        const legacy = legacyMap.get(symbol) || { qty: 0, multiplier: 1 };
        let legacyQty = legacy.qty;
        const multiplier = legacy.multiplier; // Assuming multiplier doesn't change intraday for same symbol

        // Get PrevClose
        const prevCloseData = prevCloseMap[symbol];
        const prevClose = (prevCloseData?.status === 'ok' && prevCloseData.close != null) ? prevCloseData.close : null;

        let m6_1_realized = 0;
        let m6_2_realized = 0;
        let status: 'ok' | 'missing_prev_close' = 'ok';

        if (legacyQty !== 0 && prevClose === null) {
            status = 'missing_prev_close';
        }

        // Queue for New Positions: { qty, price }
        const newBatches: { qty: number; price: number }[] = [];

        // Sort today's trades
        const symbolTrades = txsToday
            .filter(t => t.symbol.toUpperCase() === symbol)
            .sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

        for (const tx of symbolTrades) {
            const qty = tx.qty; // Signed quantity: Buy > 0, Sell < 0
            const price = tx.price;
            const txMultiplier = tx.multiplier; // Should match legacy multiplier

            if (qty === 0) continue;

            let remainingTxQty = qty;

            // Try to match against Legacy first
            if (legacyQty !== 0 && Math.sign(remainingTxQty) !== Math.sign(legacyQty)) {
                // Closing Legacy
                const absTx = Math.abs(remainingTxQty);
                const absLeg = Math.abs(legacyQty);
                const matchAbs = Math.min(absTx, absLeg);

                const matchQty = Math.sign(remainingTxQty) * matchAbs; // The chunk of tx used to close

                // Update Legacy PnL
                // Formula: -matchQty * (Price - PrevClose) * Multiplier
                if (prevClose !== null) {
                    m6_1_realized += -matchQty * (price - prevClose) * txMultiplier;
                } else {
                    status = 'missing_prev_close';
                }

                legacyQty += matchQty; // Reduce legacy (towards zero)
                remainingTxQty -= matchQty;
            }

            // If there is still quantity left, interact with New Batches
            if (remainingTxQty !== 0) {
                // Check sign of first batch
                const batchSign = newBatches.length > 0 ? Math.sign(newBatches[0].qty) : 0;

                if (batchSign !== 0 && Math.sign(remainingTxQty) !== batchSign) {
                    // Closing New Positions
                    while (remainingTxQty !== 0 && newBatches.length > 0) {
                        const batch = newBatches[0];
                        const absTx = Math.abs(remainingTxQty);
                        const absBatch = Math.abs(batch.qty);
                        const matchAbs = Math.min(absTx, absBatch);

                        const matchQty = Math.sign(remainingTxQty) * matchAbs;

                        // Update New PnL
                        // Formula: -matchQty * (Price - EntryPrice) * Multiplier
                        m6_2_realized += -matchQty * (price - batch.price) * txMultiplier;

                        batch.qty += matchQty; // Reduce batch
                        remainingTxQty -= matchQty;

                        if (batch.qty === 0) {
                            newBatches.shift();
                        }
                    }
                }

                // If still remaining (flipped or adding), add to New Batches
                if (remainingTxQty !== 0) {
                    newBatches.push({ qty: remainingTxQty, price: price });
                }
            }
        }

        results[symbol] = {
            m6_1_realized,
            m6_2_realized,
            remainingLegacyQty: legacyQty,
            remainingNewBatches: newBatches,
            multiplier,
            status
        };
    }

    return results;
}
