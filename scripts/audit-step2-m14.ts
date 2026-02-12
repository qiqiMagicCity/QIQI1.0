
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';

async function runM14Audit() {
    console.log('--- [Step 2 Audit] M14 Engine Trace: 2026-01-06_NVDA ---');

    // 1. Prepare transactions that lead to holding NVDA on 2026-01-06
    const transactions: any[] = [
        {
            symbol: 'NVDA',
            qty: 10,
            price: 150,
            transactionTimestamp: new Date('2025-12-20').getTime(),
            side: 'BUY',
            opKind: 'TRADE'
        }
    ];

    // 2. Prepare eodMap
    // We simulate a scenario where the map is missing the key OR has a status that causes issues
    const eodMap: any = {
        // Missing 2026-01-06_NVDA to see if it triggers the "not_in_eodMap" reason logic
        '2026-01-02_NVDA': { status: 'ok', close: 180 },
        '2026-01-05_NVDA': { status: 'ok', close: 185 },
        // '2026-01-06_NVDA': { status: 'ok', close: 188 } // Commented out to simulate missing
    };

    const targetDates = ['2026-01-02', '2026-01-05', '2026-01-06'];

    console.log('\n[Scenario A] NVDA Missing in eodMap');
    calcM14DailyCalendar(transactions, targetDates, eodMap);

    console.log('\n[Scenario B] NVDA in eodMap but status is NOT ok');
    eodMap['2026-01-06_NVDA'] = { status: 'error', close: 0 };
    calcM14DailyCalendar(transactions, targetDates, eodMap);

    console.log('\n[Scenario C] NVDA in eodMap, status is ok, but close is NaN');
    eodMap['2026-01-06_NVDA'] = { status: 'ok', close: NaN };
    calcM14DailyCalendar(transactions, targetDates, eodMap);
}

runM14Audit().catch(console.error);
