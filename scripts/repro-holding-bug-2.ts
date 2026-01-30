
import { buildHoldingsSnapshot, Tx } from '../src/lib/holdings/fifo';

const tx1: Tx = {
    symbol: 'AAPL',
    assetType: 'stock',
    side: 'BUY',
    qty: 50,
    price: 150,
    transactionTimestamp: 1672531200000,
    opKind: 'BUY',
    multiplier: 1
};

const tx2: Tx = {
    symbol: 'AAPL', // Same symbol
    assetType: 'option', // Different Asset Type (Simulating classification error)
    side: 'BUY',
    qty: 500,
    price: 155,
    transactionTimestamp: 1672617600000,
    opKind: 'BUY',
    multiplier: 100 // Different multiplier too?
};

const transactions = [tx1, tx2];

console.log("--- Running Repro (Split Identity) ---");
const snapshot = buildHoldingsSnapshot(transactions);

snapshot.holdings.forEach(h => {
    console.log(`Holding Symbol: ${h.symbol}, Asset: ${h.assetType}, NetQty: ${h.netQty}`);
});

if (snapshot.holdings.length === 2) {
    console.log("BUG REPRODUCED: Two holdings for AAPL generated.");
} else if (snapshot.holdings.length === 1 && snapshot.holdings[0].netQty === 550) {
    console.log("Merged successfully (Unexpected with current code).");
}
