
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';
import { toNyCalendarDayString } from '../src/lib/ny-time';

const today = toNyCalendarDayString(new Date());

const mockTxs: any[] = [
    { symbol: 'AAPL', qty: 10, price: 150, transactionTimestamp: new Date('2026-01-01T10:00:00Z').getTime(), side: 'BUY', opKind: 'TRADE', multiplier: 1 },
    { symbol: 'NKE_OPT', qty: 1, price: 5, transactionTimestamp: new Date('2026-01-01T10:05:00Z').getTime(), side: 'BUY', opKind: 'TRADE', multiplier: 100 }
];

const targetDates = ['2026-01-02'];

function runTestCase(name: string, eodMap: any) {
    console.log(`\n--- Test Case: ${name} ---`);
    const results = calcM14DailyCalendar(mockTxs, targetDates, eodMap);
    const day = results['2026-01-02'];
    console.log(`Status: ${day.status}`);
    console.log(`Missing Symbols: [${day.missingSymbols?.join(', ')}]`);
    console.log(`PnL: ${day.totalPnl}`);

    if (day.status === 'missing_data' && day.missingSymbols?.length) {
        console.log('Result: Detected as MISSING (Correct if true missing exists)');
    } else if (day.status === 'partial') {
        console.log('Result: Detected as PARTIAL/ESTIMATED (Correct for plan_limited/no_liquidity)');
    } else {
        console.log(`Result: ${day.status}`);
    }
}

// Case 1: Plan Limited
runTestCase('Stocks OK + Option plan_limited', {
    '2026-01-02_AAPL': { status: 'ok', close: 155 },
    '2026-01-02_NKE_OPT': { status: 'plan_limited' }
});

// Case 2: No Liquidity
runTestCase('Stocks OK + Option no_liquidity', {
    '2026-01-02_AAPL': { status: 'ok', close: 155 },
    '2026-01-02_NKE_OPT': { status: 'no_liquidity' }
});

// Case 3: True Missing
runTestCase('Stocks OK + One truly missing', {
    '2026-01-02_AAPL': { status: 'ok', close: 155 },
    // NKE_OPT is missing from map entirely
});

// Case 4: Fetch Incomplete Boundary
runTestCase('Fetch Incomplete', {
    'FETCH_INCOMPLETE_BOUNDARY': { status: 'fetch_incomplete', meta: { lastFetchedDate: '2026-01-01' } }
});
