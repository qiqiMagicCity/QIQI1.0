
// Mock types
interface OfficialCloseResult {
    status: string;
    close?: number;
    tradingDate?: string;
}

// Mock getOfficialCloses return
const mockGetOfficialCloses = (date: string, symbol: string): Record<string, OfficialCloseResult> => {
    return {
        [symbol]: {
            status: 'ok',
            close: 100,
            tradingDate: date
        }
    };
};

async function runVerifyEodKeys() {
    const symbol = 'AAPL';
    const dates = ['2025-11-28', '2025-12-01'];

    // Simulate fetching multiple dates
    const results = dates.map(d => mockGetOfficialCloses(d, symbol));

    // Simulate merging into mtdEodMap (Current Logic in HoldingsProvider)
    const newMtdEodMap: Record<string, OfficialCloseResult> = {};
    results.forEach(res => Object.assign(newMtdEodMap, res));

    console.log('--- Current Logic Simulation ---');
    console.log('Keys in newMtdEodMap:', Object.keys(newMtdEodMap));
    console.log('Value for AAPL:', newMtdEodMap['AAPL']);

    // Simulate what calcM14DailyCalendar expects
    const expectedKey1 = `2025-11-28_${symbol}`;
    const expectedKey2 = `2025-12-01_${symbol}`;

    console.log(`Lookup ${expectedKey1}:`, newMtdEodMap[expectedKey1]);
    console.log(`Lookup ${expectedKey2}:`, newMtdEodMap[expectedKey2]);

    if (newMtdEodMap[expectedKey1] === undefined) {
        console.error('FAIL: 2025-11-28 data is missing or not accessible via date-keyed lookup!');
    }
}

runVerifyEodKeys();
