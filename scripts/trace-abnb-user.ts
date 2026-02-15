
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();

async function traceUser() {
    const uid = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';
    console.log(`=== FULL TRACE FOR USER ${uid} ===`);

    // 1. Transactions
    const txRef = db.collection(`users/${uid}/transactions`);
    const txSnap = await txRef.get();

    console.log(`Transactions: ${txSnap.size}`);

    let longCount = 0;
    let shortCount = 0;

    txSnap.docs.forEach(doc => {
        const d = doc.data();
        const rawSym = d.symbol || d.ticker || d.underlying || '';
        if (rawSym.includes('ABNB')) {
            console.log(`[TX] ${doc.id}: ${rawSym} ${d.side} ${d.quantity || d.qty} @ ${d.price}`);
            // Check Date
            const date = new Date(d.transactionTimestamp);
            console.log(`     Date: ${date.toISOString()} (${d.transactionTimestamp})`);
            console.log(`     Raw:`, JSON.stringify(d, null, 2));
        }
    });

    // 2. Trades
    const tradeRef = db.collection(`users/${uid}/trades`);
    const tradeSnap = await tradeRef.get();
    console.log(`Trades: ${tradeSnap.size}`);

    tradeSnap.docs.forEach(doc => {
        const d = doc.data();
        const rawSym = d.symbol || d.ticker || d.underlying || '';
        if (rawSym.includes('ABNB')) {
            console.log(`[TRADE] ${doc.id}: ${rawSym} ${d.side} ${d.quantity || d.qty} @ ${d.price}`);
            const date = new Date(d.transactionTimestamp);
            console.log(`     Date: ${date.toISOString()} (${d.transactionTimestamp})`);
            console.log(`     Raw:`, JSON.stringify(d, null, 2));
        }
    });

    // 3. Search for the 15:58 timestamp in ALL docs of this user
    const targetTs = new Date('2026-02-12T15:58:00-05:00').getTime();
    console.log(`Searching for timestamp close to: ${targetTs} (${new Date(targetTs).toISOString()})`);

    const allDocs = [...txSnap.docs, ...tradeSnap.docs];
    allDocs.forEach(doc => {
        const d = doc.data();
        const ts = d.transactionTimestamp;
        if (Math.abs(ts - targetTs) < 300000) { // 5 min window
            console.log(`\n!!! MATCH TIMESTAMP [${doc.id}] !!!`);
            console.log(JSON.stringify(d, null, 2));
        }
    });

    // 4. Snapshots check
    const snapRef = db.collection(`users/${uid}/snapshots`);
    const snapSnap = await snapRef.get();
    snapSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.inventory) {
            const keys = Object.keys(d.inventory).filter(k => k.includes('ABNB'));
            if (keys.length) {
                console.log(`[SNAPSHOT] ${doc.id}:`, keys, d.inventory[keys[0]]);
            }
        }
    });
}

traceUser().catch(console.error);
