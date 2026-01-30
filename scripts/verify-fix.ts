
import { buildHoldingsSnapshot, Tx } from '@/lib/holdings/fifo';

// Mock Data reproducing the "Spli-Brain" / "Pollution" scenario
const mockTransactions: Tx[] = [
    {
        id: 'tx_stock_buy',
        symbol: 'BA',
        assetType: 'stock',
        side: 'BUY',
        qty: 1000, // Bought 1000 shares
        price: 150.00,
        transactionTimestamp: 1000000000000, // Old time
        multiplier: 1
    },
    {
        id: 'tx_option_sell_1',
        symbol: 'BA', // Simplified symbol, usually causes pollution
        assetType: 'option', // RAW DATA SAYS OPTION
        side: 'SELL',
        qty: -5, // Sell 5 contracts
        price: 15.20,
        transactionTimestamp: 1738140000000, // 2025-01-29
        multiplier: 100, // Option multiplier
        isOption: true,
        opKind: 'STC'
    },
    {
        id: 'tx_option_sell_2',
        symbol: 'BA',
        assetType: 'option',
        side: 'SELL',
        qty: -5,
        price: 12.50,
        transactionTimestamp: 1745920000000, // 2025-04-29
        multiplier: 100,
        isOption: true,
        opKind: 'STC'
    }
];

console.log("=== Regression Test: BA Option vs Stock Isolation ===\n");

const snapshot = buildHoldingsSnapshot(mockTransactions);

console.log("Generated Holdings:");
snapshot.holdings.forEach((h, i) => {
    console.log(`[Holding ${i + 1}]`);
    console.log(`  Symbol: ${h.symbol}`);
    console.log(`  AssetType: ${h.assetType}`);
    console.log(`  NetQty: ${h.netQty}`);
    console.log(`  Multiplier: ${h.multiplier}`);
    console.log(`  Total Cost Basis: ${h.costBasis}`);
    console.log(`  Reference (raw): ${h.lots.length} lots`);
});

// Verification Logic
const stockPosition = snapshot.holdings.find(h => h.assetType === 'stock');
const optionPosition = snapshot.holdings.find(h => h.assetType === 'option');

let pass = true;

if (!stockPosition) {
    console.error("FAIL: Stock position missing!");
    pass = false;
} else if (stockPosition.netQty !== 1000) {
    console.error(`FAIL: Stock position polluted! Expected 1000, Got ${stockPosition.netQty}`);
    pass = false;
} else {
    console.log("PASS: Stock position is clean (1000).");
}

if (!optionPosition) {
    console.error("FAIL: Option position missing (merged into stock?)");
    pass = false;
} else if (optionPosition.netQty !== -10) {
    console.error(`FAIL: Option position incorrect! Expected -10, Got ${optionPosition.netQty}`);
    pass = false;
} else if (optionPosition.multiplier !== 100) {
    console.error(`FAIL: Option multiplier degraded! Expected 100, Got ${optionPosition.multiplier}`);
    pass = false;
} else {
    console.log("PASS: Option position is correct (-10 contracts, multiplier 100).");
}

if (pass) {
    console.log("\n✅ TEST PASSED: Stocks and Options are correctly isolated.");
} else {
    console.error("\n❌ TEST FAILED.");
    process.exit(1);
}
