
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';

const transactions: any[] = [
    { symbol: 'NVDA', qty: 10, price: 150, transactionTimestamp: new Date('2025-12-20').getTime(), side: 'BUY', opKind: 'TRADE' }
];

const targetDates = ['2026-01-02', '2026-01-05', '2026-01-06'];

const eodMap: any = {
    '2026-01-02_NVDA': { status: 'ok', close: 180 },
    '2026-01-05_NVDA': { status: 'ok', close: 185 },
};

// SCENARIO: Jan 6 missing, but previous OK
const results = calcM14DailyCalendar(transactions, targetDates, eodMap);

console.log('--- AUDIT RESULT ---');
targetDates.forEach(d => {
    const r = results[d];
    console.log(`${d}: status=${r.status}, missing=${JSON.stringify(r.missingSymbols || [])}`);
});
