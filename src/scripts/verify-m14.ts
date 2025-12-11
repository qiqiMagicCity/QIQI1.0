import { calcM14DailyCalendar } from '../lib/pnl/calc-m14-daily-calendar';
import { OfficialCloseResult } from '../lib/data/official-close-repo';
import { Tx } from '../hooks/use-user-transactions';

// Mock Data
const transactions: Tx[] = [
    // Day 1: Buy 10 NVDA @ 100
    {
        id: '1', symbol: 'NVDA',

        side: 'BUY',
        qty: 10,
        price: 100,
        transactionTimestamp: 1762182000000, // 2025-11-03T10:00:00-05:00 (approx)
        source: 'trades',
        multiplier: 1,
        assetType: 'stock',
        type: 'Buy',
        opKind: 'BUY',
        actionLabel: '买入',
        isOption: false,
        warnings: []
    },
    // Day 2: Sell 10 NVDA @ 120
    {
        id: '2', symbol: 'NVDA',

        side: 'SELL',
        qty: -10, // Negative for SELL
        price: 120,
        transactionTimestamp: 1762268400000, // 2025-11-04T10:00:00-05:00 (approx)
        source: 'trades',
        multiplier: 1,
        assetType: 'stock',
        type: 'Sell',
        opKind: 'SELL',
        actionLabel: '卖出',
        isOption: false,
        warnings: []
    }
];

const targetDates = ['2025-11-03', '2025-11-04'];

const eodMap: Record<string, OfficialCloseResult> = {
    // Day 0 (Prev)
    '2025-11-01_NVDA': { tradingDate: '2025-11-01', close: 90, status: 'ok' }, // Prev close
    // Day 1
    '2025-11-03_NVDA': { tradingDate: '2025-11-03', close: 110, status: 'ok' },
    // Day 2
    '2025-11-04_NVDA': { tradingDate: '2025-11-04', close: 125, status: 'ok' },
};

async function runVerifyM14() {
    console.log("Running M14 Verification...");
    const results = calcM14DailyCalendar(transactions, targetDates, eodMap);

    console.log("Results:", JSON.stringify(results, null, 2));

    const day1 = results['2025-11-03'];
    const day2 = results['2025-11-04'];

    let passed = true;

    if (day1.totalPnl !== 100) {
        console.error(`Day 1 Failed: Expected 100, got ${day1.totalPnl}`);
        passed = false;
    }
    if (day2.totalPnl !== 100) {
        console.error(`Day 2 Failed: Expected 100, got ${day2.totalPnl}`);
        passed = false;
    }

    if (passed) {
        console.log("✅ Verification Passed!");
    } else {
        console.error("❌ Verification Failed!");
        process.exit(1);
    }
}

runVerifyM14();
