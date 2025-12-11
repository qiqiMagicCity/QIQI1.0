import { DailyPnlResult } from './calc-m14-daily-calendar';

/**
 * M12: MTD (Month-to-Date) Total PnL
 * Formula: Sum of Daily Total PnL (M6) from Month Start to Today.
 * 
 * @param dailyPnlMap - Map of daily PnL results (from M14 calculation)
 * @param mtdStartDate - Start date of the current month (YYYY-MM-DD)
 * @param todayNy - Current NY trading day (YYYY-MM-DD)
 * @returns Total MTD PnL
 */
export function calcM12_Mtd(
    dailyPnlMap: Record<string, DailyPnlResult>,
    mtdStartDate: string,
    todayNy: string
): number {
    let total = 0;
    const dates = Object.keys(dailyPnlMap).sort();

    for (const date of dates) {
        if (date >= mtdStartDate && date <= todayNy) {
            const dayResult = dailyPnlMap[date];
            if (dayResult && typeof dayResult.totalPnl === 'number') {
                total += dayResult.totalPnl;
            }
        }
    }

    return total;
}
