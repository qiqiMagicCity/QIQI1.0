
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.error("=== Check EOD Status ===");
    const symbol = 'GOOGL260918C150';
    const date = '2026-02-04';
    const docId = `${date}_${symbol}`;

    try {
        const snap = await db.collection('officialCloses').doc(docId).get();
        if (snap.exists) {
            console.error("Document exists:", JSON.stringify(snap.data(), null, 2));
        } else {
            console.error("Document does NOT exist.");
        }
    } catch (e) {
        console.error("Error", e);
    }
}

main();
