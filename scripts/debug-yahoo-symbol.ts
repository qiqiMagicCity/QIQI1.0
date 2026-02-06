
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.error("=== Debugging Option Symbol Format Issues (Stderr) ===");

    // 1. Check what is actually in officialCloses for the "Short" symbol
    const shortSymbol = 'AAPL260206C270';
    const date = '2026-02-04';
    const docId = `${date}_${shortSymbol}`;

    console.error(`Checking Firestore for doc: ${docId}`);
    try {
        const snap = await db.collection('officialCloses').doc(docId).get();
        if (snap.exists) {
            console.error("Snapshot found:", JSON.stringify(snap.data(), null, 2));
        } else {
            console.error("Snapshot NOT found (completely missing).");
        }
    } catch (e) {
        console.error("Firestore read error:", e);
    }
}

main().catch(err => console.error(err));
