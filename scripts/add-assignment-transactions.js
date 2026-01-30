
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'qiqi-1-0'
    });
}
const db = admin.firestore();

async function main() {
    const userId = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

    console.log('Starting assignment transaction insertion...');

    // Date: 2026-01-09 09:30:00 NY Time
    // UTC needs to be calculated. 
    // NY is UTC-5 in Jan (Standard Time).
    // 09:30 NY = 14:30 UTC.
    const dateStr = '2026-01-09';
    const ts = 1767969000000; // 2026-01-09T14:30:00.000Z
    const dateIso = new Date(ts).toISOString();

    // 1. Stock Assignment (Sell NKE @ 65)
    // Using a deterministic ID based on timestamp to avoid duplication if run multiple times
    const stockTxId = 'assignment-nke-stock-' + ts;
    const stockTx = {
        id: stockTxId,
        userId,
        symbol: 'NKE',
        assetType: 'stock',
        type: 'SELL',       // Action
        side: 'SELL',       // Logic Side
        quantity: 800,
        price: 65.0,
        total: 800 * 65.0,  // 52000
        transactionTimestamp: ts,
        transactionDate: dateIso,
        transactionDateNy: dateStr,
        multiplier: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'script-assignment'
    };

    // 2. Option Assignment (Buy To Close NKE 260109 C 65 @ 0)
    const optionSymbol = 'NKE 260109 C 65';
    const optionTxId = 'assignment-nke-option-' + ts;
    const optionTx = {
        id: optionTxId,
        userId,
        symbol: optionSymbol,
        assetType: 'option',
        type: 'BTC',        // Buy To Close
        side: 'BUY',        // Closing a Short position is a BUY side operation
        quantity: 8,        // 8 contracts
        price: 0,           // Expired/Assigned at 0 cost to close
        total: 0,
        transactionTimestamp: ts,
        transactionDate: dateIso,
        transactionDateNy: dateStr,
        multiplier: 100,

        // Enrich with Option Details
        right: 'C',
        strike: 65,
        expiry: ts,
        contractKey: 'NKE-C-65-2026-01-09',

        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'script-assignment'
    };

    try {
        const batch = db.batch();

        const stockRef = db.collection('users').doc(userId).collection('transactions').doc(stockTxId);
        batch.set(stockRef, stockTx);

        const optionRef = db.collection('users').doc(userId).collection('transactions').doc(optionTxId);
        batch.set(optionRef, optionTx);

        await batch.commit();
        console.log('Successfully inserted assignment transactions!');
        console.log('Stock ID:', stockTxId);
        console.log('Option ID:', optionTxId);
    } catch (error) {
        console.error('Error inserting transactions:', error);
    }
}

main().catch(console.error);
