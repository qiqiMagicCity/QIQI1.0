import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}
const db = getFirestore();

async function inspect() {
    const symbols = ['NVO261218C50', 'NIO260618P3.5'];
    const dates = ['2026-02-05', '2026-02-06', '2026-02-09'];

    for (const symbol of symbols) {
        console.log(`\nInspecting ${symbol}:`);
        for (const date of dates) {
            const docId = `${date}_${symbol}`;
            const doc = await db.collection('officialCloses').doc(docId).get();
            if (doc.exists) {
                const data = doc.data();
                console.log(`  ${date}: close=${data?.close}, status=${data?.status}, provider=${data?.provider}`);
            } else {
                console.log(`  ${date}: MISSING`);
            }
        }
    }
}

inspect().catch(console.error);
