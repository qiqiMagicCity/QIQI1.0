import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}
const db = getFirestore();

async function inspect() {
    const symbol = 'GOOGL260918C150';
    const dates = ['2026-02-04', '2026-02-05', '2026-02-06', '2026-02-09'];

    console.log(`Inspecting EOD data for ${symbol}:`);
    for (const date of dates) {
        const docId = `${date}_${symbol}`;
        const doc = await db.collection('officialCloses').doc(docId).get();
        if (doc.exists) {
            const data = doc.data();
            console.log(`[OK] ${date}: close=${data?.close}, status=${data?.status}, provider=${data?.provider}`);
        } else {
            console.log(`[MISSING] ${date}`);
        }
    }

    // Also check the underlying GOOGL for context
    const underlying = 'GOOGL';
    console.log(`\nInspecting EOD data for ${underlying}:`);
    for (const date of dates) {
        const docId = `${date}_${underlying}`;
        const doc = await db.collection('officialCloses').doc(docId).get();
        if (doc.exists) {
            const data = doc.data();
            console.log(`[OK] ${date}: close=${data?.close}, status=${data?.status}, provider=${data?.provider}`);
        } else {
            console.log(`[MISSING] ${date}`);
        }
    }
}

inspect().catch(console.error);
