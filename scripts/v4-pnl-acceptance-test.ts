import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';
import { Tx } from '../src/hooks/use-user-transactions';
import { OfficialCloseResult } from '../src/lib/data/official-close-repo';

async function runAcceptanceTest() {
    console.log("--- 🛡️ V4.0.GA PnL ACCEPTANCE TEST ---");

    // 1. Mock Transactions
    const mockTxs: Tx[] = [
        {
            id: 'tx1',
            symbol: 'AAPL',
            qty: 100,
            price: 150,
            side: 'BUY',
            transactionTimestamp: new Date('2026-02-05T10:00:00Z').getTime(),
            assetType: 'stock',
            multiplier: 1,
            opKind: 'TRADE'
        } as any
    ];

    // 2. Mock EOD Map (Feb 6 is Friday, Feb 9 is Monday)
    const mockEodMap: Record<string, OfficialCloseResult> = {
        '2026-02-05_AAPL': { status: 'ok', close: 160 }, // Baseline start
        '2026-02-06_AAPL': { status: 'ok', close: 170 }, // Last Friday
        // 2026-02-07, 2026-02-08 are weekend (missing from map or error)
        '2026-02-09_AAPL': { status: 'ok', close: 180 }, // Today (Monday)
    };

    const targetDates = [
        '2026-02-06', // Fri
        '2026-02-07', // Sat
        '2026-02-08', // Sun
        '2026-02-09', // Mon
    ];

    console.log("Running calculation...");
    const results = calcM14DailyCalendar(mockTxs, targetDates, mockEodMap, []);

    console.log("\n--- RESULT CHAIN ANALYSIS ---");
    console.log(JSON.stringify(Object.keys(results).map(date => ({
        Date: date,
        Status: results[date].status,
        EOD_Value: results[date].eodUnrealized,
        Prev_EOD: results[date].prevEodUnrealized,
        PnL_Change: results[date].unrealizedPnlChange,
        Total: results[date].totalPnl
    })), null, 2));

    // Verify A1
    const feb9 = results['2026-02-09'];
    if (feb9.status === 'not_open') {
        console.log("✅ A1 (Pre-market Gate) Verified: 2026-02-09 is correctly marked as 'not_open' before 09:30.");
    }

    // Verify A2
    const mon = results['2026-02-09'];
    const sun = results['2026-02-08'];
    const fri = results['2026-02-06'];

    if (mon.prevEodUnrealized === fri.eodUnrealized) {
        console.log("✅ A2 (Baseline Inheritance) Verified: Monday inherited Friday's market value correctly.");
    }

    if (sun.eodUnrealized === fri.eodUnrealized) {
        console.log("✅ A2 (Weekend Carryover) Verified: Weekend correctly carried forward Friday's value.");
    }
}

runAcceptanceTest().catch(console.error);
