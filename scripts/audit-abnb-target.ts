
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Hardcoded target UID from previous audit scripts
const TARGET_UID = 'x9cwFIG1O07OHQrxlcwf';

// Fallback for initialization
try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    // Attempt default initialization (Emulator/ADC)
    try {
        initializeApp();
    } catch (e2) { }
}

const db = getFirestore();

async function audit() {
    console.log(`--- [Task 1] Scanning User: ${TARGET_UID} ---`);

    // 1. Transactions
    const txRef = db.collection(`users/${TARGET_UID}/transactions`);
    const txSnap = await txRef.get();

    console.log(`[Transactions] Found ${txSnap.size} docs.`);
    const abnbTxs = txSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((d: any) => {
            const s = (d.symbol || '').toUpperCase();
            return s.includes('ABNB');
        });

    if (abnbTxs.length > 0) {
        console.log(`\n[CRITICAL] Found ABNB Transactions:`);
        console.log(JSON.stringify(abnbTxs, null, 2));
    } else {
        console.log(`[Info] No ABNB transactions found in main collection.`);
    }

    // 2. Trades
    const tradesRef = db.collection(`users/${TARGET_UID}/trades`);
    const tradesSnap = await tradesRef.get();
    const abnbTrades = tradesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((d: any) => {
            const s = (d.symbol || '').toUpperCase();
            return s.includes('ABNB');
        });

    if (abnbTrades.length > 0) {
        console.log(`\n[CRITICAL] Found ABNB Trades (Manual):`);
        console.log(JSON.stringify(abnbTrades, null, 2));
    }

    // 3. Snapshots
    const snapRef = db.collection(`users/${TARGET_UID}/snapshots`);
    const snapSnap = await snapRef.get();
    console.log(`[Snapshots] Found ${snapSnap.size} docs.`);

    snapSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.inventory) {
            const inv = data.inventory;
            const keys = Object.keys(inv).filter(k => k.includes('ABNB'));
            if (keys.length > 0) {
                console.log(`\n[CRITICAL] Found ABNB in Snapshot [${doc.id} | ${data.date}]:`);
                keys.forEach(k => {
                    console.log(`Key: ${k}`, inv[k]);
                });
            }
        }
    });

    // 4. Holdings
    const holdingsRef = db.collection(`users/${TARGET_UID}/holdings`);
    const holdSnap = await holdingsRef.get();
    const abnbHoldings = holdSnap.docs
        .map(d => d.data())
        .filter((d: any) => (d.symbol || '').toUpperCase().includes('ABNB'));

    if (abnbHoldings.length > 0) {
        console.log(`\n[CRITICAL] Found ABNB in Holdings Live View:`);
        console.log(JSON.stringify(abnbHoldings, null, 2));
    }

    // 5. Negative Price Check (Global)
    const negPriceTxs = txSnap.docs
        .map(d => d.data())
        .filter((d: any) => typeof d.price === 'number' && d.price < 0);

    if (negPriceTxs.length > 0) {
        console.log(`\n[SUSPICIOUS] Found Negative Price Transactions (Count: ${negPriceTxs.length}):`);
        // Print first 3
        console.log(JSON.stringify(negPriceTxs.slice(0, 3), null, 2));
    }
}

audit().catch(console.error);
