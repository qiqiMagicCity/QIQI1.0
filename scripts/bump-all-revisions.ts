
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

/**
 * Script: Jumpstart the Data (Bump All Revisions)
 * This script forces the frontend to invalidate its EOD cache for all active symbols
 * by incrementing the 'eodRevision' field in the 'stockDetails' collection.
 */
async function bumpAllRevisions() {
    console.log("=== BUMP ALL REVISIONS: STARTING ELECTROSHOCK ===");

    // 1. Identify "Active Symbols" across all users (to be safe, we bump everyone we find)
    const activeSymbols = new Set<string>();
    const userDocs = await db.collection('users').listDocuments();

    console.log(`Scanning ${userDocs.length} users for active symbols...`);
    for (const userRef of userDocs) {
        // Option A: Scan transactions (More comprehensive)
        const txSnap = await userRef.collection('transactions').get();
        txSnap.forEach(doc => {
            const data = doc.data();
            const rawSym = data.symbol || data.ticker;
            if (rawSym) {
                const sym = rawSym.trim().toUpperCase();
                activeSymbols.add(sym);
            }
        });
    }

    console.log(`Found ${activeSymbols.size} total symbols to bump.`);

    // 2. Batch Update 'stockDetails'
    const batchSize = 100;
    const symbolsArray = Array.from(activeSymbols);
    let count = 0;

    for (let i = 0; i < symbolsArray.length; i += batchSize) {
        const chunk = symbolsArray.slice(i, i + batchSize);
        const batch = db.batch();

        for (const sym of chunk) {
            const docRef = db.collection('stockDetails').doc(sym);
            const doc = await docRef.get();

            let currentRev = 0;
            if (doc.exists) {
                currentRev = doc.data()?.eodRevision || 0;
            }

            const nextRev = currentRev + 1;
            batch.set(docRef, {
                eodRevision: nextRev,
                lastBumpedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            console.log(`- Updated ${sym}: ${currentRev} -> ${nextRev}`);
            count++;
        }

        await batch.commit();
        console.log(`Committed batch ${i / batchSize + 1}...`);
    }

    console.log(`\n=== COMPLETED: ${count} Revisions Bumped ===`);
    console.log("Expected result: Frontend should now detect version change and fetch fresh EOD data.");
}

bumpAllRevisions().catch(err => {
    console.error("Critical Failure during bumpAllRevisions:", err);
    process.exit(1);
});
