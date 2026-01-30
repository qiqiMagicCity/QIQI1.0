
import { buildHoldingsSnapshot, Tx } from '../src/lib/holdings/fifo';

const tx1: Tx = {
    symbol: 'AAPL',
    assetType: 'stock',
    side: 'BUY',
    qty: 50,
    price: 150,
    transactionTimestamp: 1672531200000, // Some date in past
    opKind: 'BUY'
};

const tx2: Tx = {
    symbol: 'AAPL',
    assetType: 'stock', // Explicitly stock
    side: 'BUY',
    qty: 500,
    price: 155,
    transactionTimestamp: 1672617600000, // Later date
    opKind: 'BUY',
    // Simulate the issue description where new transaction might look slightly different
    // "Transaction ID: gCpvRarfPZYGV84UaLu1" (We can't simulate ID affecting logic unless we add it to Tx if it existed, but Tx interface doesn't have ID)
};

const transactions = [tx1, tx2];

console.log("--- Running Repro ---");
const snapshot = buildHoldingsSnapshot(transactions);
const aapl = snapshot.holdings.find(h => h.symbol === 'AAPL');

if (aapl) {
    console.log(`Symbol: ${aapl.symbol}`);
    console.log(`NetQty: ${aapl.netQty}`);
    console.log(`Lots: ${aapl.lots.length}`);
    aapl.lots.forEach((l, i) => console.log(`  Lot ${i}: Qty=${l.qty}, Price=${l.price}`));
} else {
    console.log("No AAPL holding found.");
}
