import { PnLEvent } from "@/lib/pnl/calc-m4-m5-2-global-fifo";

export interface WinRateStats {
    winCount: number;
    lossCount: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    pnlRatio: number;
    expectancy: number;
}

export function calculateWinRateStats(
    winCount: number,
    lossCount: number,
    pnlEvents: PnLEvent[]
): WinRateStats {
    let totalWinPnl = 0;
    let totalLossPnl = 0;

    (pnlEvents || []).forEach(e => {
        if (e.pnl > 0) totalWinPnl += e.pnl;
        if (e.pnl < 0) totalLossPnl += Math.abs(e.pnl);
    });

    const avgWin = winCount > 0 ? totalWinPnl / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLossPnl / lossCount : 0;
    const pnlRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const totalCount = winCount + lossCount;
    const winRate = totalCount > 0 ? winCount / totalCount : 0;
    const lossRate = totalCount > 0 ? lossCount / totalCount : 0;
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss);

    return {
        winCount,
        lossCount,
        winRate,
        avgWin,
        avgLoss,
        pnlRatio,
        expectancy
    };
}
