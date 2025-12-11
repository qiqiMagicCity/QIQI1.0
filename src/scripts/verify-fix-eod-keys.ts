
// Mock types
interface OfficialCloseResult {
    status: string;
    close?: number;
    tradingDate?: string;
}

// Helper to transform EOD map from { Symbol: Result } to { Date_Symbol: Result }
function rekeyEodMap(
    sourceMap: Record<string, OfficialCloseResult>,
    dateStr: string
): Record<string, OfficialCloseResult> {
    const out: Record<string, OfficialCloseResult> = {};
    for (const [sym, res] of Object.entries(sourceMap)) {
        // Mock normalization
        const normSym = sym.toUpperCase();
        const key = `${dateStr}_${normSym}`;
        out[key] = res;
    }
    return out;
}

async function run() {
    const symbol = 'AAPL';
    const dates = ['2025-11-28', '2025-12-01'];

    // Mock getOfficialCloses return
    const mockGetOfficialCloses = (date: string, symbol: string): Record<string, OfficialCloseResult> => {
        return {
            [symbol]: {
                status: 'ok',
                close: date === '2025-11-28' ? 100 : 105,
                tradingDate: date
            }
        };
    };

    // Simulate fetching multiple dates
    const mtdResults = dates.map(d => mockGetOfficialCloses(d, symbol));

    // [FIXED LOGIC] Simulate merging into mtdEodMap using rekeyEodMap
    const newMtdEodMap: Record<string, OfficialCloseResult> = {};
    mtdResults.forEach((res, idx) => {
        const date = dates[idx];
        const rekeyed = rekeyEodMap(res, date);
        Object.assign(newMtdEodMap, rekeyed);
    });

    console.log('--- Fixed Logic Simulation ---');
    console.log('Keys in newMtdEodMap:', Object.keys(newMtdEodMap));

    const key1 = `2025-11-28_${symbol}`;
    const key2 = `2025-12-01_${symbol}`;

    console.log(`Lookup ${key1}:`, newMtdEodMap[key1]);
    console.log(`Lookup ${key2}:`, newMtdEodMap[key2]);

    if (newMtdEodMap[key1] && newMtdEodMap[key2]) {
        console.log('SUCCESS: Both dates are preserved with composite keys!');
    } else {
        console.error('FAIL: Data missing or incorrect keys.');
    }

    // Simulate fullEodMap construction
    const refEodMap = mockGetOfficialCloses('2025-11-26', symbol); // Previous day
    const refDateUsed = '2025-11-26';

    const fullEodMap = {
        ...rekeyEodMap(refEodMap, refDateUsed),
        ...newMtdEodMap
    };

    console.log('Keys in fullEodMap:', Object.keys(fullEodMap));
}

run();
