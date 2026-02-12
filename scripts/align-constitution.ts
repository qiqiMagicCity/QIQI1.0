import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}
const db = getFirestore();

async function alignWithConstitution() {
    const today = '2026-02-09';
    const targets = [
        { symbol: 'GOOGL260918C150', price: 179 },
        { symbol: 'NVO261218C50', price: 7.2 },
        { symbol: 'NIO260618P3.5', price: 0.16 }
    ];

    console.log(`Aligning today's option EODs with "Constitutional Logic"...`);

    for (const t of targets) {
        const docId = `${today}_${t.symbol}`;
        console.log(`Updating ${t.symbol} to status: no_liquidity, price: ${t.price}...`);

        const newRev = 10; // Explicitly bump to clear all caches
        await db.collection('officialCloses').doc(docId).set({
            symbol: t.symbol,
            tradingDate: today,
            close: t.price,
            status: 'no_liquidity', // CRITICAL: Rule 2 status
            provider: 'constitution_align_fix',
            isEstimated: true,      // CRITICAL: UI Grey Badge trigger
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            rev: newRev
        }, { merge: true });

        // Ensure stockDetails is synced to this version
        await db.collection('stockDetails').doc(t.symbol).set({
            eodRevision: newRev,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
}

alignWithConstitution().catch(console.error);
