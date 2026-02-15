
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function fetchEvidence() {
    console.log("=== EVIDENCE FETCH START ===");
    console.log(`Target User: ${TARGET_UID}`);

    // 1. Fetch Transaction uHMAF3mNU7gKHYlveMIy
    const txId = 'uHMAF3mNU7gKHYlveMIy';
    console.log(`\n[fetching transaction: ${txId}]...`);
    const txRef = db.doc(`users/${TARGET_UID}/transactions/${txId}`);
    const txSnap = await txRef.get();

    if (txSnap.exists) {
        console.log(">>> Transaction Document FOUND:");
        console.log(JSON.stringify(txSnap.data(), null, 2));
    } else {
        console.log(">>> Transaction Document NOT FOUND.");
    }

    // 2. Fetch Snapshot 2025-08-31
    // Snapshots might be stored by ID (auto-generated) or custom ID. 
    // We'll search by date field or ID if it matches the date.
    console.log(`\n[fetching snapshot for date: 2025-08-31]...`);
    const snapCol = db.collection(`users/${TARGET_UID}/snapshots`);
    // Try to query by date
    const q = snapCol.where('date', '==', '2025-08-31');
    const querySnap = await q.get();

    if (!querySnap.empty) {
        console.log(`>>> Snapshot Document(s) FOUND (${querySnap.size}):`);
        querySnap.docs.forEach(doc => {
            console.log(`-- Doc ID: ${doc.id} --`);
            const data = doc.data();
            // Just print the inventory relevant parts to avoid huge output, but user asked for raw JSON.
            // I will print the ABNB part specifically and the structure.
            if (data.inventory && data.inventory['ABNB']) {
                console.log(`[ABNB Inventory]:`, JSON.stringify(data.inventory['ABNB'], null, 2));
            } else {
                console.log(`[ABNB Inventory]: NOT FOUND in this snapshot.`);
            }
            // Print full doc structure summary or specific fields if too large? 
            // User asked for "Raw JSON". I'll print the whole thing but maybe truncate unrelated symbols if huge.
            // Let's print the ABNB entry and metadata.
            const { inventory, ...meta } = data;
            console.log(`[Metadata]:`, JSON.stringify(meta, null, 2));
        });
    } else {
        console.log(">>> Snapshot Document NOT FOUND by date query.");
        // Fallback: list all snapshots to see if date format differs
        const allSnaps = await snapCol.limit(10).get();
        console.log("Listing recent snapshots dates for verification:");
        allSnaps.docs.forEach(d => console.log(d.id, d.data().date));
    }
}

fetchEvidence().catch(console.error);
