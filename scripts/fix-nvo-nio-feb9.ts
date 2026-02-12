import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}
const db = getFirestore();

async function fix() {
    const targets = [
        { symbol: 'NVO261218C50', price: 7.2 },
        { symbol: 'NIO260618P3.5', price: 0.16 }
    ];
    const date = '2026-02-09';
    const rev = 8; // New revision for both

    for (const t of targets) {
        const docId = `${date}_${t.symbol}`;
        console.log(`Fixing ${t.symbol} to ${t.price} (rev ${rev})...`);

        await db.collection('officialCloses').doc(docId).set({
            symbol: t.symbol,
            tradingDate: date,
            close: t.price,
            status: 'ok',
            provider: 'manual_carry_forward_fix',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            rev
        }, { merge: true });

        await db.collection('stockDetails').doc(t.symbol).set({
            eodRevision: rev,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    console.log("Done.");
}

fix().catch(console.error);
