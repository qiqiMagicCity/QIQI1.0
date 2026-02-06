
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.error("=== Check NVO EOD Status ===");
    const date = '2026-02-04';
    const symbol = 'NVO';
    const docId = `${date}_${symbol}`;

    console.log(`Checking ${docId}...`);
    const snap = await db.collection('officialCloses').doc(docId).get();
    if (snap.exists) {
        console.log("FOUND:", JSON.stringify(snap.data(), null, 2));
    } else {
        console.log("NOT FOUND");
    }
}

main();
