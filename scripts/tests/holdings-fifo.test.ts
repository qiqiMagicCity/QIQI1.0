
import assert from 'node:assert';
import { buildHoldingsSnapshot, Tx } from '../../src/lib/holdings/fifo';

console.log('[HOLDINGS-FIFO TEST] Running tests...');

// Test Suite
const tests = {
  "U1: NFLX stock long position": () => {
    const txs: Tx[] = [
      { symbol: 'NFLX', side: 'BUY', qty: 100, price: 1242.00, transactionTimestamp: 1, assetType: 'stock' },
      { symbol: 'NFLX', side: 'SELL', qty: -52, price: 1300.00, transactionTimestamp: 2, assetType: 'stock' },
    ];
    const { holdings } = buildHoldingsSnapshot(txs);
    const nflx = holdings.find(h => h.symbol === 'NFLX');

    assert.ok(nflx, "NFLX holding should exist");
    assert.strictEqual(nflx.netQty, 48, "U1-netQty");
    assert.strictEqual(nflx.multiplier, 1, "U1-multiplier");
    assert.strictEqual(nflx.side, 'LONG', "U1-side");
    assert.strictEqual(nflx.costPerUnit, 1242.00, "U1-costPerUnit");
    assert.strictEqual(nflx.costBasis, 59616.00, "U1-costBasis");
  },

  "U2: Long option position": () => {
    const txs: Tx[] = [
      { symbol: 'SPY', side: 'BUY', qty: 2, price: 3.50, transactionTimestamp: 1, assetType: 'option' },
    ];
    const { holdings } = buildHoldingsSnapshot(txs);
    const spy = holdings.find(h => h.symbol === 'SPY');

    assert.ok(spy, "SPY option holding should exist");
    assert.strictEqual(spy.netQty, 2, "U2-netQty");
    assert.strictEqual(spy.multiplier, 100, "U2-multiplier");
    assert.strictEqual(spy.side, 'LONG', "U2-side");
    assert.strictEqual(spy.costPerUnit, 3.50, "U2-costPerUnit");
    assert.strictEqual(spy.costBasis, 700, "U2-costBasis"); // 2 * 3.50 * 100
  },

  "U3: Short option position": () => {
    const txs: Tx[] = [
      { symbol: 'QQQ', side: 'SELL', qty: -1, price: 2.40, transactionTimestamp: 1, assetType: 'option' },
    ];
    const { holdings } = buildHoldingsSnapshot(txs);
    const qqq = holdings.find(h => h.symbol === 'QQQ');

    assert.ok(qqq, "QQQ option holding should exist");
    assert.strictEqual(qqq.netQty, -1, "U3-netQty");
    assert.strictEqual(qqq.multiplier, 100, "U3-multiplier");
    assert.strictEqual(qqq.side, 'SHORT', "U3-side");
    assert.strictEqual(qqq.costPerUnit, 2.40, "U3-costPerUnit");
    assert.strictEqual(qqq.costBasis, 240, "U3-costBasis"); // 1 * 2.40 * 100
  },

  "U4: Position flip from long to short": () => {
    const txs: Tx[] = [
      { symbol: 'TSLA', side: 'BUY', qty: 10, price: 100, transactionTimestamp: 1, assetType: 'stock' },
      { symbol: 'TSLA', side: 'SELL', qty: -15, price: 110, transactionTimestamp: 2, assetType: 'stock' },
    ];
    const { holdings } = buildHoldingsSnapshot(txs);
    const tsla = holdings.find(h => h.symbol === 'TSLA');
    
    assert.ok(tsla, "TSLA holding should exist");
    assert.strictEqual(tsla.netQty, -5, "U4-netQty");
    assert.strictEqual(tsla.side, 'SHORT', "U4-side");
    assert.strictEqual(tsla.costPerUnit, 110, "U4-costPerUnit");
    assert.strictEqual(tsla.costBasis, 550, "U4-costBasis"); // 5 * 110 * 1
  },

  "U5: Position flip from short to long": () => {
    const txs: Tx[] = [
      { symbol: 'AMD', side: 'SELL', qty: -20, price: 150, transactionTimestamp: 1, assetType: 'stock' },
      { symbol: 'AMD', side: 'BUY', qty: 30, price: 140, transactionTimestamp: 2, assetType: 'stock' },
    ];
    const { holdings } = buildHoldingsSnapshot(txs);
    const amd = holdings.find(h => h.symbol === 'AMD');

    assert.ok(amd, "AMD holding should exist");
    assert.strictEqual(amd.netQty, 10, "U5-netQty");
    assert.strictEqual(amd.side, 'LONG', "U5-side");
    assert.strictEqual(amd.costPerUnit, 140, "U5-costPerUnit");
    assert.strictEqual(amd.costBasis, 1400, "U5-costBasis"); // 10 * 140 * 1
  },

  "U6: Net zero position should not be in holdings": () => {
    const txs: Tx[] = [
        { symbol: 'DIS', side: 'BUY', qty: 10, price: 100, transactionTimestamp: 1, assetType: 'stock' },
        { symbol: 'DIS', side: 'SELL', qty: -10, price: 105, transactionTimestamp: 2, assetType: 'stock' },
    ];
    const { holdings, audit } = buildHoldingsSnapshot(txs);
    const dis = holdings.find(h => h.symbol === 'DIS');

    assert.strictEqual(dis, undefined, "U6-holding-should-be-undefined");
    assert.strictEqual(audit.positionsZeroNetDropped, 1, "U6-audit");
  },
};

// Run all tests
let passed = 0;
let failed = 0;
for (const [name, testFn] of Object.entries(tests)) {
  try {
    testFn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    failed++;
  }
}

console.log(`\n[HOLDINGS-FIFO TEST] ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    process.exit(1);
}
