
import assert from 'node:assert';
import { calcM5_1_Trading, M5_1_Input } from '../calc-m5-1-trading';
import { Tx } from '../../../hooks/use-user-transactions';
import { PriceRecord } from '../../../price/RealTimePricesProvider';

const mockToday = '2025-01-01';
const todayTs = new Date('2025-01-01T10:00:00-05:00').getTime(); // 10 AM NY
const yestTs = new Date('2024-12-31T10:00:00-05:00').getTime(); // Yesterday

console.log('[M5.1 TEST] Running Three Buckets Logic Tests...');

function createTx(
    symbol: string,
    side: 'BUY' | 'SELL',
    qty: number,
    price: number,
    ts: number,
    id: string
): Tx {
    return {
        id,
        symbol,
        // Existing logic in calc-m5-1: it uses tx.qty. 
        // My implementation in calc-m5-1 uses Math.abs(qty) and checks logic side based on sign.
        // Wait, in my rewrite I did `const side = tx.qty > 0 ? 'BUY' : 'SELL'`.
        // So I must ensure signed qty.
        qty: side === 'BUY' ? qty : -qty,
        price,
        transactionTimestamp: ts,
        date: mockToday,
        type: 'TRADE',
        opKind: side === 'BUY' ? 'BUY' : 'SELL',
        amount: price * qty * (side === 'BUY' ? -1 : 1),
        commission: 0,
        multiplier: 1,
        currency: 'USD',
        side: side,
        assetType: 'stock',
        source: 'manual',
    } as unknown as Tx;
}

// Helper to construct historical txs
function createHistTx(symbol: string, qty: number, tsStart: number): Tx {
    return {
        id: 'hist-' + Math.random(),
        symbol,
        qty, // Signed
        price: 100,
        transactionTimestamp: tsStart,
        opKind: qty > 0 ? 'BUY' : 'SELL', // Simplistic
        multiplier: 1,
        date: '2024-12-31', // Yesterday
        type: 'TRADE',
        side: qty > 0 ? 'BUY' : 'SELL',
        assetType: 'stock',
        source: 'manual',
        amount: 0,
        commission: 0,
        currency: 'USD',
    } as unknown as Tx;
}


const tests = {
    // Case 1: S0=+1000, Sell 100 -> M5=0
    'Case 1: Long Base + Sell Only -> No M5 PnL': () => {
        const hist = createHistTx('AAPL', 1000, yestTs); // Yesterday
        const sell = createTx('AAPL', 'SELL', 100, 150, todayTs, 't1'); // Today

        const input: M5_1_Input = {
            transactions: [hist, sell],
            todayNy: mockToday,
        };

        const res = calcM5_1_Trading(input);
        assert.strictEqual(res.realized, 0, 'Realized should be 0');
        assert.strictEqual(res.unrealized, 0, 'Unrealized should be 0');
        assert.strictEqual(res.m5_1, 0, 'Total M5 should be 0');
    },

    // Case 2: S0=+1000, Sell 100 @p1, Buy 100 @p2 -> Realized
    'Case 2: Long Base + Sell(p1) + Buy(P2) -> Realized': () => {
        const hist = createHistTx('AAPL', 1000, yestTs);
        const sell = createTx('AAPL', 'SELL', 100, 200, todayTs, 't1'); // Sell @ 200
        const buy = createTx('AAPL', 'BUY', 100, 150, todayTs + 1000, 't2');   // Buy back @ 150

        // Expect PnL = (200 - 150) * 100 = 5000
        const res = calcM5_1_Trading({
            transactions: [hist, sell, buy],
            todayNy: mockToday
        });

        assert.strictEqual(res.realized, 5000);
        assert.strictEqual(res.unrealized, 0);
    },

    // Case 3: S0=+1000, Buy 100 @p1, Sell 100 @p2 -> Realized (Intraday Long)
    'Case 3: Long Base + Buy(p1) + Sell(p2) -> Realized': () => {
        const hist = createHistTx('AAPL', 1000, yestTs);
        const buy = createTx('AAPL', 'BUY', 100, 150, todayTs, 't1');
        const sell = createTx('AAPL', 'SELL', 100, 200, todayTs + 1000, 't2');

        // PnL = (200 - 150) * 100 = 5000
        const res = calcM5_1_Trading({ transactions: [hist, buy, sell], todayNy: mockToday });
        assert.strictEqual(res.realized, 5000);
    },

    // Case 4: S0=+1000, Sell 1200 -> 1000 Hist (Ignore), 200 New Short (Float)
    'Case 4: Long Base + Sell Overshoot -> Partial Float': () => {
        const hist = createHistTx('AAPL', 1000, yestTs);
        const sell = createTx('AAPL', 'SELL', 1200, 150, todayTs, 't1'); // Sell @ 150

        // Mark Price = 140. New Short 200. Entry 150.
        // Float PnL = (150 - 140) * 200 = 200 * 10 = 2000.
        // Wait: Short PnL = (Entry - Mark) * Qty = (150 - 140) * 200 = 2000. Correct.

        const prices = new Map<string, PriceRecord>();
        prices.set('AAPL', { price: 140, ts: 0, status: 'open' as any });

        const res = calcM5_1_Trading({
            transactions: [hist, sell],
            todayNy: mockToday,
            currentPrices: prices
        });

        assert.strictEqual(res.realized, 0);
        assert.strictEqual(res.unrealized, 2000);
    },

    // Case 5: S0=0, Sell 100 -> Float
    'Case 5: No Base + Sell -> Float': () => {
        const sell = createTx('AAPL', 'SELL', 100, 150, todayTs, 't1');
        // Mark 160. Short 100 @ 150. PnL = (150 - 160) * 100 = -1000
        const prices = new Map<string, PriceRecord>();
        prices.set('AAPL', { price: 160, ts: 0, status: 'open' as any });

        const res = calcM5_1_Trading({ transactions: [sell], todayNy: mockToday, currentPrices: prices });
        assert.strictEqual(res.unrealized, -1000);
    },

    // Case 7: S0=-500, Buy 100 -> M5=0 (Reduce Hist Short)
    'Case 7: Short Base + Buy -> No M5 PnL': () => {
        const hist = createHistTx('AAPL', -500, yestTs);
        const buy = createTx('AAPL', 'BUY', 100, 150, todayTs, 't1');

        const res = calcM5_1_Trading({ transactions: [hist, buy], todayNy: mockToday });
        assert.strictEqual(res.m5_1, 0);
    },

    // Case 8: S0=-500, Buy 100 @p2, Sell 100 @p1 -> Realized
    'Case 8: Short Base + Buy + Sell -> Realized': () => {
        const hist = createHistTx('AAPL', -500, yestTs);
        const buy = createTx('AAPL', 'BUY', 100, 150, todayTs, 't1');
        const sell = createTx('AAPL', 'SELL', 100, 200, todayTs + 1000, 't2'); // Sell back

        // Pending C_short_reduce (Buy @ 150).
        // Sell @ 200 matches C_short_reduce.
        // PnL = (Sell 200 - PendingBuy 150) * 100 = 5000.

        const res = calcM5_1_Trading({ transactions: [hist, buy, sell], todayNy: mockToday });
        assert.strictEqual(res.realized, 5000);
    },

    // Mix Case: Overshoot Sell then Partial Cover
    'Mix Case: Overshoot Sell then Partial Cover': () => {
        const hist = createHistTx('AAPL', 100, yestTs);
        const sell = createTx('AAPL', 'SELL', 300, 200, todayTs, 't1'); // Sell 300 @ 200
        // - 100 reduces base (PENDING C_long_reduce).
        // - 200 opens New Short (A_short).

        const buy = createTx('AAPL', 'BUY', 150, 180, todayTs + 1000, 't2'); // Buy 150 @ 180
        // Buy Logic: Use Buy 150.
        // 1. Matches C_long_reduce (100).
        //    PnL = (Sell 200 - Buy 180) * 100 = 2000.
        //    Qty left = 50.
        // 2. Matches A_short (200 available).
        //    Match 50.
        //    PnL = (Entry 200 - Buy 180) * 50 = 1000.
        //    Remaining A_short = 150.

        // Total Realized = 3000.

        // Unrl Logic:
        // A_short has 150 @ 200.
        // Mark = 190.
        // Short PnL = (200 - 190) * 150 = 1500.

        const prices = new Map<string, PriceRecord>();
        prices.set('AAPL', { price: 190, ts: 0, status: 'open' as any });

        const res = calcM5_1_Trading({ transactions: [hist, sell, buy], todayNy: mockToday, currentPrices: prices });
        assert.strictEqual(res.realized, 3000);
        assert.strictEqual(res.unrealized, 1500);
    }
};

let passed = 0;
let failed = 0;

for (const [name, fn] of Object.entries(tests)) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e: any) {
        console.error(`✗ ${name}`);
        console.error(e.message);
        failed++;
    }
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
