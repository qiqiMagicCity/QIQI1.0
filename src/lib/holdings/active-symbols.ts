
import { Tx } from '@/hooks/use-user-transactions';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import { normalizeSymbolClient } from '@/lib/utils';
import { toNyCalendarDayString } from '@/lib/ny-time';

/**
 * Identify symbols that are "active" within a specific date range.
 * A symbol is active if:
 * 1. It has open positions at the start of the range (Held).
 * 2. OR it has any transactions during the range (Traded).
 * 
 * This allows us to avoid fetching EOD data for symbols that were fully closed
 * before the range started and never touched during the range.
 */
export function getActiveSymbols(
    transactions: Tx[],
    rangeStart: string, // YYYY-MM-DD
    rangeEnd: string    // YYYY-MM-DD
): string[] {
    if (!transactions || transactions.length === 0) return [];

    const startTs = new Date(`${rangeStart}T00:00:00`).getTime(); // Approximate, local/UTC specific doesn't matter much for cutoff
    // Better to use string comparison on NY Day for consistency

    // 1. Identify Held Symbols at Start (Positions carried over)
    // We need all transactions strictly BEFORE rangeStart
    const priorTxs = transactions.filter(tx => {
        const txDate = toNyCalendarDayString(tx.transactionTimestamp);
        return txDate < rangeStart;
    });

    const snapshot = buildHoldingsSnapshot(priorTxs);
    const heldSymbols = new Set<string>();
    snapshot.holdings.forEach(h => {
        if (h.netQty !== 0 && h.symbol) {
            heldSymbols.add(normalizeSymbolClient(h.symbol));
        }
    });

    // 2. Identify Traded Symbols during Range
    const tradedSymbols = new Set<string>();
    transactions.forEach(tx => {
        const txDate = toNyCalendarDayString(tx.transactionTimestamp);
        if (txDate >= rangeStart && txDate <= rangeEnd) {
            if (tx.symbol) tradedSymbols.add(normalizeSymbolClient(tx.symbol));
        }
    });

    // 3. Merge
    const active = new Set([...Array.from(heldSymbols), ...Array.from(tradedSymbols)]);
    return Array.from(active).sort();
}
