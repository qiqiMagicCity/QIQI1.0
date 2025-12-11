import { calcM11_Wtd } from '../lib/pnl/calc-m11-wtd';
import { calcM12_Mtd } from '../lib/pnl/calc-m12-mtd';
import { DailyPnlResult } from '../lib/pnl/calc-m14-daily-calendar';

console.log('--- Verifying Sum of Dailies Logic ---');

const mockDailyPnl: Record<string, DailyPnlResult> = {
    '2023-10-01': { date: '2023-10-01', totalPnl: 100, status: 'ok' } as any,
    '2023-10-02': { date: '2023-10-02', totalPnl: 200, status: 'ok' } as any,
    '2023-10-03': { date: '2023-10-03', totalPnl: 300, status: 'ok' } as any, // Today
    '2023-10-04': { date: '2023-10-04', totalPnl: 400, status: 'ok' } as any, // Future
};

const todayNy = '2023-10-03';
const wtdStart = '2023-10-02'; // Mon
const mtdStart = '2023-10-01'; // 1st

const wtd = calcM11_Wtd(mockDailyPnl, wtdStart, todayNy);
console.log(`WTD (Expected: 200+300=500): ${wtd}`);

const mtd = calcM12_Mtd(mockDailyPnl, mtdStart, todayNy);
console.log(`MTD (Expected: 100+200+300=600): ${mtd}`);

if (wtd === 500 && mtd === 600) {
    console.log('✅ Verification Passed');
} else {
    console.error('❌ Verification Failed');
    process.exit(1);
}
