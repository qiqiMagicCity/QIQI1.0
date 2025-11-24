import { PnLEvent } from './calc-m4-m5-2-global-fifo';

/**
 * M11: WTD (Week-to-Date) Realized PnL
 * Formula: Sum(Realized PnL within period) + (Current Unrealized PnL - Base Unrealized PnL)
 * 
 * @param events - List of realized PnL events
 * @param wtdStartDate - Start date of the current week (YYYY-MM-DD)
 * @param currentUnrealized - Current Total Unrealized PnL
 * @param baseUnrealized - Total Unrealized PnL at the end of the previous week
 * @returns Total WTD PnL
 */
export function calcM11_Wtd(
    events: PnLEvent[],
    wtdStartDate: string,
    currentUnrealized: number | null,
    baseUnrealized: number
): number | null {
    if (currentUnrealized === null) return null; // If current state is invalid, result is invalid

    const realizedFlow = (events || [])
        .filter(e => e.date >= wtdStartDate)
        .reduce((sum, e) => sum + e.pnl, 0);

    const unrealizedDelta = currentUnrealized - baseUnrealized;

    return realizedFlow + unrealizedDelta;
}
