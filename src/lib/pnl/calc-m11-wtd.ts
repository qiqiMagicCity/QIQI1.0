import { DailyPnlResult } from './calc-m14-daily-calendar';

/**
 * M11: WTD (Week-to-Date) Total PnL
 * Formula: Sum of Daily Total PnL (M6) from Week Start to Today.
 * 
 * @param dailyPnlMap - Map of daily PnL results (from M14 calculation)
 * @param wtdStartDate - Start date of the current week (YYYY-MM-DD)
 * @param todayNy - Current NY trading day (YYYY-MM-DD)
 * @returns Total WTD PnL
 */
export function calcM11_Wtd(
    dailyPnlMap: Record<string, DailyPnlResult>,
    wtdStartDate: string,
    todayNy: string
): number {
    let total = 0;
    const dates = Object.keys(dailyPnlMap).sort();

    for (const date of dates) {
        if (date >= wtdStartDate && date <= todayNy) {
            const dayResult = dailyPnlMap[date];
            // Only sum if we have valid data. 
            // Note: In the Provider, we will ensure 'Today' has a value (injected M6) even if EOD is missing.
            if (dayResult && typeof dayResult.totalPnl === 'number') {
                if (dayResult.status === 'ok' || dayResult.status === 'partial' || dayResult.status === 'market_closed') {
                    total += dayResult.totalPnl;
                }
            }
        }
    }

    return total;
}
