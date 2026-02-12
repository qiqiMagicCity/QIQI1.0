
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

async function run() {
    console.log("=== SURGICAL REPAIR: NIO260618P3.5 ===");
    const symbol = 'NIO260618P3.5';
    const missingDates = ['2025-11-03', '2025-11-04'];

    // 1. Find the last known price before the gap
    console.log("Looking for price before 2025-11-03...");
    const snap = await db.collection('officialCloses')
        .where('symbol', '==', symbol)
        .where('date', '<', '2025-11-03')
        .orderBy('date', 'desc')
        .limit(1)
        .get();

    if (snap.empty) {
        console.log("No previous history found! Cannot forward fill.");
        return;
    }

    const prevData = snap.docs[0].data();
    const fillPrice = prevData.close;
    console.log(`Found Reference: ${prevData.date} @ ${fillPrice}`);

    // 2. Fill the gaps
    const batch = db.batch();
    for (const date of missingDates) {
        console.log(`Queueing fix for ${date}...`);
        const ref = db.collection('officialCloses').doc(`${date}_${symbol}`);
        batch.set(ref, {
            date: date,
            symbol: symbol,
            close: fillPrice,
            tradingDate: date,
            status: 'ok',
            provider: 'surgical_repair',
            note: 'Manual Targeted Repair',
            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    // 3. Commit
    await batch.commit();
    console.log("Committed.");
}

run().catch(e => console.error(e));
