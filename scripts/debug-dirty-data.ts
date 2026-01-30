
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'studio-9804216494-c2b75';

if (!admin.apps.length) {
    try {
        admin.initializeApp({ projectId });
    } catch (e) {
        // console.error(e);
    }
}

const db = getFirestore();
const uid = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';
const symbol = 'TSDD';

async function auditStock() {
    console.log(`Auditing stock ${symbol} for user ${uid}...`);

    const col1 = 'transactions';
    const col2 = 'trades';

    const q1 = await db.collection(`users/${uid}/${col1}`).where('symbol', '==', symbol).get();
    const q2 = await db.collection(`users/${uid}/${col2}`).where('symbol', '==', symbol).get();

    let totalQty = 0;
    let buyQty = 0;
    let sellQty = 0;

    const allTx: any[] = [];

    const processDoc = (doc: any, source: string) => {
        const d = doc.data();
        let qty = Number(d.quantity || d.qty || 0);
        const side = (d.side || d.type || '').toUpperCase();

        let signedQty = 0;

        if (side.includes('BUY') || side.includes('COVER')) {
            signedQty = Math.abs(qty);
            buyQty += signedQty;
        } else if (side.includes('SELL') || side.includes('SHORT')) {
            signedQty = -Math.abs(qty);
            sellQty += Math.abs(qty);
        }

        totalQty += signedQty;

        allTx.push({
            id: doc.id,
            source,
            date: d.transactionDateNy,
            side,
            qty: signedQty,
            rawQty: qty,
            price: d.price
        });
    };

    q1.docs.forEach(d => processDoc(d, col1));
    // CAUTION: If we process trades, we might be double counting if they are mirrors.
    // Ideally we assume transactions is SSOT now.
    // Let's log trades separately to see if there are orphaned records affecting calc?
    // Wait, the frontend might be reading from BOTH or just ONE. Assuming transactions is SSOT.

    // Check if Holdings document exists and what it says
    const holdingsRef = db.collection(`users/${uid}/holdings`).doc(symbol);
    const hSnap = await holdingsRef.get();

    console.log(`\n=== 1. Transaction Summation ===`);
    console.log(`Total Buys: ${buyQty}`);
    console.log(`Total Sells: ${sellQty}`);
    console.log(`Net Quantity (Calculated): ${totalQty}`);

    console.log(`\n=== 2. Holdings Document (Frontend Persistence) ===`);
    if (hSnap.exists) {
        console.log(JSON.stringify(hSnap.data(), null, 2));
    } else {
        console.log(`[WARNING] No Holdings Document found for ${symbol}`);
    }

    console.log(`\n=== 3. Are there records in 'trades' collection? ===`);
    console.log(`Count: ${q2.size}`);
    if (q2.size > 0) {
        console.log(`(NOTE: If the app is double-reading or if 'trades' has unique records not in 'transactions', this explains the 8333 vs 3333 gap)`);
        // Let's sum trades too just to see
        let tQty = 0;
        q2.docs.forEach(d => {
            const data = d.data();
            const side = (data.side || data.type || '').toUpperCase();
            const q = Number(data.quantity || 0);
            if (side.includes('BUY') || side.includes('COVER')) tQty += q;
            else tQty -= q;
        });
        console.log(`Net Quantity in 'trades': ${tQty}`);
        console.log(`Sum of BOTH (if double counted): ${totalQty + tQty}`);
    }

}

auditStock().catch(console.error);
