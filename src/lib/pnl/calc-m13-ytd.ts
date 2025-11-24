import { PnLEvent } from './calc-m4-m5-2-global-fifo';

/**
 * M13: YTD (Year-to-Date) Realized PnL
 * Formula: Sum(Realized PnL within period) + (Current Unrealized PnL - Base Unrealized PnL)
 * 
 * @param events - List of realized PnL events
 * @param ytdStartDate - Start date of the current year (YYYY-MM-DD)
 * @param currentUnrealized - Current Total Unrealized PnL
 * @param baseUnrealized - Total Unrealized PnL at the end of the previous year
 * @returns Total YTD PnL
 */
export function calcM13_Ytd(
    events: PnLEvent[],
    ytdStartDate: string,
    currentUnrealized: number | null,
    baseUnrealized: number
): number | null {
    if (currentUnrealized === null) return null;

    const realizedFlow = (events || [])
        .filter(e => e.date >= ytdStartDate)
        .reduce((sum, e) => sum + e.pnl, 0);

    const unrealizedDelta = currentUnrealized - baseUnrealized;

    return realizedFlow + unrealizedDelta;
}
