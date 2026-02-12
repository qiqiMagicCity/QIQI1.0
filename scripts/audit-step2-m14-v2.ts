
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';

async function runM14AuditV2() {
    console.log('--- [Step 2 Audit] M14 Engine Trace V2: Why NVDA is in missingSymbols? ---');

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

    const targetDates = ['2026-01-02', '2026-01-05', '2026-01-06'];

    console.log('\n[Scenario D] NVDA is missing on 2026-01-06 AND 2026-01-05 AND 2026-01-02');
    const eodMapD: any = {}; // Completely empty eodMap
    const resD = calcM14DailyCalendar(transactions, targetDates, eodMapD);
    console.log(`2026-01-06 status: ${resD['2026-01-06'].status}, missingSymbols: ${JSON.stringify(resD['2026-01-06'].missingSymbols)}`);

    console.log('\n[Scenario E] NVDA missing on 2026-01-06, but present and OK on 2026-01-02/05');
    const eodMapE: any = {
        '2026-01-02_NVDA': { status: 'ok', close: 180 },
        '2026-01-05_NVDA': { status: 'ok', close: 185 },
    };
    const resE = calcM14DailyCalendar(transactions, targetDates, eodMapE);
    console.log(`2026-01-06 status: ${resE['2026-01-06'].status}, missingSymbols: ${JSON.stringify(resE['2026-01-06'].missingSymbols)}`);
}

runM14AuditV2().catch(console.error);
