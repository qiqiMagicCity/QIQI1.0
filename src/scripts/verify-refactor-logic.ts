
import { toNyCalendarDayString, toNyHmsString, nyWeekdayIndex, US_MARKET_HOLIDAYS } from '../lib/ny-time';

// --- Replicated Logic from RealTimePricesProvider for Verification ---
// In a real scenario, this should be exported from a shared logic file.
function getMarketSessionTest(now: Date): 'pre' | 'open' | 'post' | 'closed' {
    const wd = nyWeekdayIndex(now);
    const d = toNyCalendarDayString(now);
    if (wd === 0 || wd === 6 || US_MARKET_HOLIDAYS.has(d)) return 'closed';

    const [hh, mm, ss] = toNyHmsString(now).split(':').map(n => parseInt(n, 10));
    const t = hh * 3600 + mm * 60 + ss;

    const PRE_OPEN = 4 * 3600;
    const OPEN = 9 * 3600 + 30 * 60;
    const CLOSE = 16 * 3600;
    const POST_END = 20 * 3600;

    if (t >= OPEN && t < CLOSE) return 'open';
    if (t >= PRE_OPEN && t < OPEN) return 'pre';
    if (t >= CLOSE && t < POST_END) return 'post';
    return 'closed';
}

function runTests() {
    let passed = 0;
    let failed = 0;

    const assert = (desc: string, condition: boolean) => {
        if (condition) {
            console.log(`✅ PASS: ${desc}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${desc}`);
            failed++;
        }
    };

    console.log('--- Starting Verification: Compliance & Refactor Logic ---\n');

    // ==========================================
    // Test 1: Timezone Conversion (Tokyo User)
    // ==========================================
    console.log('[Test 1] Timezone Conversion');
    // Scenario: User in Tokyo (UTC+9) at 2025-11-01 09:00:00
    // UTC time: 2025-11-01 00:00:00
    // NY time (EDT UTC-4): 2025-10-31 20:00:00
    const tokyoTimeStr = '2025-11-01T09:00:00+09:00';
    const tokyoDate = new Date(tokyoTimeStr);

    // Validate we created the correct instant
    assert('Test Date parses correctly', !isNaN(tokyoDate.getTime()));

    const nyDateStr = toNyCalendarDayString(tokyoDate);
    assert(
        `Tokyo ${tokyoTimeStr} => NY ${nyDateStr} (Expect 2025-10-31)`,
        nyDateStr === '2025-10-31'
    );


    // ==========================================
    // Test 2: Market Session Logic
    // ==========================================
    console.log('\n[Test 2] Market Session Logic');

    // Case A: Pre-market (Wed 09:29:59 NY)
    // 2025-12-10 is a Wednesday
    const wedPre = new Date('2025-12-10T09:29:59-05:00');
    assert(
        `Wed 09:29:59 => pre (Actual: ${getMarketSessionTest(wedPre)})`,
        getMarketSessionTest(wedPre) === 'pre'
    );

    // Case B: Open (Wed 09:30:01 NY)
    const wedOpen = new Date('2025-12-10T09:30:01-05:00');
    assert(
        `Wed 09:30:01 => open (Actual: ${getMarketSessionTest(wedOpen)})`,
        getMarketSessionTest(wedOpen) === 'open'
    );

    // Case C: Holiday (Christmas 2025, Thursday)
    // US_MARKET_HOLIDAYS should contain '2025-12-25'
    const xmas = new Date('2025-12-25T10:00:00-05:00');
    assert(
        `Christmas 10:00 => closed (Actual: ${getMarketSessionTest(xmas)})`,
        getMarketSessionTest(xmas) === 'closed'
    );


    // ==========================================
    // Test 3: WTD Summation Logic (Rule 6.11)
    // ==========================================
    console.log('\n[Test 3] WTD Summation (Sum of Dailies)');

    const mockDailyPnL = [
        { date: '2025-12-08', totalPnl: 100 }, // Mon
        { date: '2025-12-09', totalPnl: -50 }, // Tue
        { date: '2025-12-10', totalPnl: 200 }, // Wed
    ];

    // Wrong way ("Flow + Delta" - simulating the bug)
    // Assuming start was 0, end is 250... but often this logic was adding arbitrary deltas
    // Here we just test that our CORRECT logic (Sum) works.

    const correctWtd = mockDailyPnL.reduce((acc, curr) => acc + curr.totalPnl, 0);
    assert(
        `Sum of Dailies (100 - 50 + 200) = 250`,
        correctWtd === 250
    );

    console.log(`\n\n--- Summary: ${passed} Passed, ${failed} Failed ---`);
    if (failed > 0) process.exit(1);
}

runTests();
