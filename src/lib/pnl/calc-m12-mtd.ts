import { PnLEvent } from './calc-m4-m5-2-global-fifo';

/**
 * M12: MTD (Month-to-Date) Realized PnL
 * Formula: Sum(Realized PnL within period) + (Current Unrealized PnL - Base Unrealized PnL)
 * 
 * @param events - List of realized PnL events
 * @param mtdStartDate - Start date of the current month (YYYY-MM-DD)
 * @param currentUnrealized - Current Total Unrealized PnL
 * @param baseUnrealized - Total Unrealized PnL at the end of the previous month
 * @returns Total MTD PnL
 */
export function calcM12_Mtd(
    events: PnLEvent[],
    mtdStartDate: string,
    currentUnrealized: number | null,
    baseUnrealized: number
): number | null {
    if (currentUnrealized === null) return null;

    const realizedFlow = (events || [])
        .filter(e => e.date >= mtdStartDate)
        .reduce((sum, e) => sum + e.pnl, 0);

    const unrealizedDelta = currentUnrealized - baseUnrealized;

    return realizedFlow + unrealizedDelta;
}
