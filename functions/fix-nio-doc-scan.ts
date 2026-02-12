
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Generate past dates
function getPastDate(base: string, minusDays: number) {
    const d = new Date(base);
    d.setDate(d.getDate() - minusDays);
    return d.toISOString().slice(0, 10);
}

async function run() {
    console.log("=== DOC SCAN REPAIR: NIO260618P3.5 ===");
    const symbol = 'NIO260618P3.5';
    const missing = ['2025-11-03', '2025-11-04'];

    // 1. Find a reference price by checking specific docs backwards
    let refPrice = 0;
    let foundDate = '';

    for (let i = 1; i <= 10; i++) {
        const dateDate = getPastDate('2025-11-03', i);
        const docId = `${dateDate}_${symbol}`;
        // console.log(`Checking ${docId}...`);

        try {
            const snap = await db.collection('officialCloses').doc(docId).get();
            if (snap.exists) {
                const d = snap.data();
                if (d && d.close > 0) {
                    refPrice = d.close;
                    foundDate = dateDate;
                    console.log(`FOUND reference at ${dateDate}: ${refPrice}`);
                    break;
                }
            }
        } catch (e) {
            console.warn(`Error reading ${docId}: ${e}`);
        }
    }

    if (refPrice === 0) {
        console.log("Could not find recent history (checked 10 days back). Aborting.");
        return;
    }

    // 2. Fix
    const batch = db.batch();
    for (const date of missing) {
        console.log(`Fixing ${date} with ${refPrice}...`);
        const ref = db.collection('officialCloses').doc(`${date}_${symbol}`);
        batch.set(ref, {
            date: date,
            symbol: symbol,
            close: refPrice,
            tradingDate: date,
            status: 'ok',
            provider: 'doc_scan_repair',
            note: 'Manual Forward Fill',
            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    await batch.commit();
    console.log("Done.");
}

run().catch(e => console.error(e));
