
import { buildHoldingsSnapshot, Tx } from '../src/lib/holdings/fifo';

function format(val: any) {
    if (val === null) return 'null';
    if (typeof val === 'number' && isNaN(val)) return 'NaN';
    return val;
}

// Emulate app's filtering logic
function isBoardable(val: any) {
    return val !== null && typeof val === 'number' && Number.isFinite(val);
}

async function runRegressionTests() {
    console.log('=== PnL Contract Regression Tests (Automated Audit) ===\n');

    const testCases = [
        {
            name: 'LONG Position (NKE)',
            txs: [
                { symbol: 'NKE', qty: 10, price: 100, transactionTimestamp: 1000, assetType: 'stock', multiplier: 1 } as Tx
            ],
            currentPrice: 110,
            expected: {
                netQty: 10,
                costBasis: 1000,
                mv: 1100,
                unrealized: 100,
                totalLifetime: 100,
                pnlPct: 0.1,
                isBoardable: true
            }
        },
        {
            name: 'SHORT Position (ABNB)',
            txs: [
                { symbol: 'ABNB', qty: -555, price: 115.7263, transactionTimestamp: 2000, assetType: 'stock', multiplier: 1 } as Tx
            ],
            currentPrice: 121.35,
            expected: {
                netQty: -555,
                costBasis: -64228.10,
                mv: -67349.25,
                unrealized: -3121.15,
                totalLifetime: -3121.15,
                pnlPct: -0.0485,
                isBoardable: true
            }
        },
        {
            name: 'MISSING PRICE (Meltdown Check)',
            txs: [
                { symbol: 'GHOST', qty: 10, price: 50, transactionTimestamp: 4000, assetType: 'stock', multiplier: 1 } as Tx
            ],
            currentPrice: null,
            expected: {
                mv: null,
                unrealized: null,
                totalLifetime: null,
                pnlPct: null,
                isBoardable: false
            }
        }
    ];

    let failCount = 0;

    for (const tc of testCases) {
        console.log(`Testing: ${tc.name}`);
        const snapshot = buildHoldingsSnapshot(tc.txs);
        const h = snapshot.holdings[0];

        if (!h && tc.currentPrice !== null) {
            console.error(`  [FAIL] No position produced for ${tc.name}`);
            failCount++;
            continue;
        }

        const price = tc.currentPrice;

        // --- Derived Calculation Logic (Matching App logic) ---
        // 1. MV (Market Value)
        const mv = price !== null ? h.netQty * h.multiplier * price : null;

        // 2. Unrealized PnL = MV - costBasis
        const unrealized = (mv !== null && h) ? mv - h.costBasis : null;

        // 3. Total Lifetime PnL = Realized + Unrealized
        // [RULE] If Unrealized is unknown, Total must be unknown (null/NaN)
        const totalLifetimePnL = unrealized !== null ? (h.realizedPnl || 0) + unrealized : null;

        // 4. PnL % = PnL / abs(costBasis)
        const pnlPct = (unrealized !== null && h.costBasis !== 0) ? unrealized / Math.abs(h.costBasis) : null;

        // 5. Boardable (Number.isFinite check)
        const boardable = isBoardable(totalLifetimePnL);

        // Assertions
        const check = (label: string, actual: any, expected: any) => {
            const pass = (actual === expected) || (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 0.05);
            if (!pass) {
                console.error(`  [FAIL] ${label}: Actual=${format(actual)}, Expected=${format(expected)}`);
                failCount++;
            } else {
                console.log(`  [PASS] ${label}: ${format(actual)}`);
            }
        };

        if (tc.expected.netQty !== undefined) check('netQty', h.netQty, tc.expected.netQty);
        if (tc.expected.costBasis !== undefined) check('costBasis', h.costBasis, tc.expected.costBasis);
        if (tc.expected.mv !== undefined) check('mv', mv, tc.expected.mv);
        if (tc.expected.unrealized !== undefined) check('unrealized', unrealized, tc.expected.unrealized);
        if (tc.expected.totalLifetime !== undefined) check('totalLifetime', totalLifetimePnL, tc.expected.totalLifetime);
        if (tc.expected.pnlPct !== undefined) check('pnlPct', pnlPct, tc.expected.pnlPct);
        if (tc.expected.isBoardable !== undefined) check('isBoardable', boardable, tc.expected.isBoardable);

        console.log('');
    }

    if (failCount > 0) {
        console.error(`Total Failures: ${failCount}`);
        process.exit(1);
    } else {
        console.log('All regression tests PASSED. Financial logic contract is intact.');
        process.exit(0);
    }
}

runRegressionTests().catch(err => {
    console.error(err);
    process.exit(1);
});
