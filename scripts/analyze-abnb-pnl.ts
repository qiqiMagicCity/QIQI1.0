
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../src/firebase/config';

// Initialize Admin SDK
if (!admin.apps.length) {
    try {
        const serviceAccount = require('../service-account-key.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
    } catch (e) {
        admin.initializeApp({ projectId: firebaseConfig.projectId });
    }
}
const db = getFirestore();
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function analyze() {
    console.log(`\n=== ABNB PnL Analysis ===`);

    // 1. Fetch All ABNB Transactions
    const txsRef = db.collection('users').doc(TARGET_UID).collection('transactions');
    const q = await txsRef.where('symbol', '==', 'ABNB').get();

    let totalShortQty = 0;
    let totalCoverQty = 0;
    let totalBuyQty = 0;
    let totalSellQty = 0;
    const txs: any[] = [];

    q.docs.forEach(doc => {
        const d = doc.data();
        txs.push({ id: doc.id, ...d });
        const qty = d.qty || d.quantity || 0;
        const side = (d.side || d.opKind || '').toUpperCase();

        if (side === 'SHORT') totalShortQty += qty;
        if (side === 'COVER') totalCoverQty += qty;
        if (side === 'BUY') totalBuyQty += qty;
        if (side === 'SELL') totalSellQty += qty;

        console.log(`[TX] ${d.date} | ${side} ${qty} @ ${d.price} | Source: ${d.source}`);
    });

    console.log(`\n[Summary]`);
    console.log(`Buy: ${totalBuyQty}, Sell: ${totalSellQty}`);
    console.log(`Short: ${totalShortQty}, Cover: ${totalCoverQty}`);

    // 2. Check Snapshot (Double verify)
    const snapsRef = db.collection('users').doc(TARGET_UID).collection('snapshots');
    const snapQ = await snapsRef.orderBy('date', 'desc').limit(1).get();
    if (!snapQ.empty) {
        const s = snapQ.docs[0].data();
        console.log(`\n[Snapshot] Date: ${s.date}`);
        const inv = s.inventory || [];
        const abnb = Array.isArray(inv) ? inv.find((i: any) => i.symbol === 'ABNB') : inv['ABNB'];
        console.log(`In Snapshot?`, abnb ? JSON.stringify(abnb) : 'NO');
    }

    // 3. Simple FIFO Simulation (Mental Model)
    // If Snapshot is Empty, and we have Short 555...
    // PnL depends on Current Price.
    // We can't easily fetch real-time price here, but we can assume.
    // If PnL is +139k on 555 shares, the Delta is ~251.
    // If Short Entry is ~115 (from previous log), Current Price must be... wait.
    // Short PnL = (Entry - Exit) * Qty.
    // 139569 = (115.72 - X) * 555.
    // 251.47 = 115.72 - X
    // X = 115.72 - 251.47 = -135.75.
    // A negative stock price is impossible.
    // CONCLUSION: Qty must be higher than 555, OR it's a realized gain from a huge previous trade?
    // OR... the Multiplier is wrong? (Options?)
    // ABNB is a stock, multiplier should be 1.

    // Check for "multiplier" field in transactions.
    txs.forEach(t => {
        if (t.multiplier && t.multiplier !== 1) {
            console.log(`[ALERT] Found Multiplier ${t.multiplier} on ${t.id}`);
        }
    });

}

analyze().catch(console.error);
