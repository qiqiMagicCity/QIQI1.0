
import { calcM14DailyCalendar } from '../lib/pnl/calc-m14-daily-calendar';
import { calcM11_Wtd } from '../lib/pnl/calc-m11-wtd';
import { OfficialCloseResult } from '../lib/data/official-close-repo';
import { Tx } from '../hooks/use-user-transactions';
import { buildHoldingsSnapshot } from '../lib/holdings/fifo';
import { calcGlobalFifo } from '../lib/pnl/calc-m4-m5-2-global-fifo';

// Mock Data
const transactions: Tx[] = [
    {
        id: '1', symbol: 'NVDA', side: 'BUY', qty: 100, price: 100,
        transactionTimestamp: 1761836400000, // 2025-10-30 (Thursday)
        source: 'trades', multiplier: 1, assetType: 'stock', type: 'Buy', opKind: 'BUY', actionLabel: '买入', isOption: false, warnings: []
    },
    {
        id: '2', symbol: 'NVDA', side: 'SELL', qty: -50, price: 130,
        transactionTimestamp: 1762268400000, // 2025-11-04 (Tuesday)
        source: 'trades', multiplier: 1, assetType: 'stock', type: 'Sell', opKind: 'SELL', actionLabel: '卖出', isOption: false, warnings: []
    }
];

const targetDates = ['2025-11-03', '2025-11-04']; // Mon, Tue
const wtdStartDate = '2025-11-03'; // Mon
const wtdBaseDate = '2025-10-31'; // Friday before

const eodMap: Record<string, OfficialCloseResult> = {
    '2025-10-31_NVDA': { tradingDate: '2025-10-31', close: 110, status: 'ok' },
    '2025-11-03_NVDA': { tradingDate: '2025-11-03', close: 120, status: 'ok' },
    '2025-11-04_NVDA': { tradingDate: '2025-11-04', close: 135, status: 'ok' },
};

// --- Calendar Calculation ---
console.log("--- Calendar Calculation ---");
const calendarResults = calcM14DailyCalendar(transactions, targetDates, eodMap);
let calendarSum = 0;
Object.values(calendarResults).forEach(r => {
    console.log(`Date: ${r.date}, Total: ${r.totalPnl}, Realized: ${r.realizedPnl}, UnrDelta: ${r.unrealizedPnlChange}`);
    calendarSum += r.totalPnl;
});
console.log(`Calendar Sum: ${calendarSum}`);

// --- WTD Calculation (Simulating HoldingsProvider logic) ---
console.log("\n--- WTD Calculation ---");

// 1. Calc Base Unrealized
const calcHistoricalUnrealized = (baseDate: string) => {
    const txs = transactions.filter(tx => {
        // Simple mock of toNyCalendarDayString
        const d = new Date(tx.transactionTimestamp).toISOString().slice(0, 10);
        return d <= baseDate;
    });

    const { holdings } = buildHoldingsSnapshot(txs);

    let total = 0;
    for (const h of holdings) {
        const key = `${baseDate}_${h.symbol}`;
        const close = eodMap[key]?.close;
        if (close) {
            total += (close - h.costPerUnit) * h.netQty * h.multiplier;
        }
    }
    return total;
};

const baseUnrealized = calcHistoricalUnrealized(wtdBaseDate);
console.log(`Base Unrealized (Day 0): ${baseUnrealized}`);

// 2. Calc Current Unrealized (Day 2)
// In HoldingsProvider, this comes from 'totalPnl' which is sum of rows.
// For Day 2 (End), we have 50 NVDA. Cost 100. Price 135.
// PnL = 50 * (135 - 100) = 1750.
const currentUnrealized = 1750;
console.log(`Current Unrealized (Day 2): ${currentUnrealized}`);

// 3. Calc Realized Flow
const { pnlEvents } = calcGlobalFifo({ transactions, todayNy: '2025-11-04' });
const realizedFlow = pnlEvents
    .filter(e => e.date >= wtdStartDate)
    .reduce((sum, e) => sum + e.pnl, 0);
console.log(`Realized Flow: ${realizedFlow}`);

// 4. WTD Result
const wtdPnl = calcM11_Wtd(calendarResults, wtdStartDate, '2025-11-04');
console.log(`WTD PnL: ${wtdPnl}`);

console.log(`\nDiscrepancy: ${wtdPnl - calendarSum}`);
