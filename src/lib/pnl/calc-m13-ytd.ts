import { DailyPnlResult } from './calc-m14-daily-calendar';

/**
 * M13: YTD (Year-to-Date) Total PnL
 * Formula: Sum of Daily Total PnL (from M14/M6) from Year Start to Today.
 * [UPDATED] Uses 'Sum of Dailies' method to match WTD/MTD and ensure consistency with Calendar.
 * 
 * @param dailyPnlMap - Map of daily PnL results
 * @param ytdStartDate - Start date of the current year (YYYY-01-01)
 * @param todayNy - Current NY trading day
 * @returns Total YTD PnL
 */
export function calcM13_Ytd(
    dailyPnlMap: Record<string, DailyPnlResult>,
    ytdStartDate: string,
    todayNy: string
): number {
    let total = 0;
    const dates = Object.keys(dailyPnlMap).sort();

    for (const date of dates) {
        if (date >= ytdStartDate && date <= todayNy) {
            const dayResult = dailyPnlMap[date];
            if (dayResult && typeof dayResult.totalPnl === 'number') {
                if (dayResult.status === 'ok' || dayResult.status === 'partial' || dayResult.status === 'market_closed') {
                    total += dayResult.totalPnl;
                }
            }
        }
    }

    return total;
}

