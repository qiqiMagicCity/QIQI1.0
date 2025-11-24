import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
// Note: This requires GOOGLE_APPLICATION_CREDENTIALS environment variable to be set
// or a valid service account key file.
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function fixBadEod() {
    const date = '2025-11-21';
    console.log(`[Fix] Starting cleanup for date: ${date}`);

    // Query for officialCloses with tradingDate == date
    // Also check for old 'date' field just in case
    const collectionRef = db.collection('officialCloses');

    // We can't easily do an OR query across fields in all SDK versions, so we'll do two queries or just iterate if ID is predictable.
    // The ID format is `${date}_${symbol}`.
    // So we can just list all docs starting with "2025-11-21_"?
    // Firestore doesn't support "startsWith" on ID directly in a simple way without a range query.
    // But we can query by field `tradingDate` == '2025-11-21'

    const snapshot = await collectionRef.where('tradingDate', '==', date).get();

    if (snapshot.empty) {
        console.log('[Fix] No documents found with tradingDate == ' + date);
        // Try legacy field 'date'
        const legacySnap = await collectionRef.where('date', '==', date).get();
        if (legacySnap.empty) {
            console.log('[Fix] No documents found with date == ' + date);
            return;
        }
        console.log(`[Fix] Found ${legacySnap.size} documents via legacy 'date' field.`);
        await deleteDocs(legacySnap);
        return;
    }

    console.log(`[Fix] Found ${snapshot.size} documents.`);
    await deleteDocs(snapshot);
}

async function deleteDocs(snapshot: admin.firestore.QuerySnapshot) {
    const batch = db.batch();
    let count = 0;
    let totalDeleted = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        // Double check to be safe
        if (data.tradingDate === '2025-11-21' || data.date === '2025-11-21') {
            // Only delete if provider is 'realtime' (the bad ones)
            // If it's 'fmp' or others, it might be legit historical backfill (though unlikely for today)
            if (data.provider === 'realtime') {
                batch.delete(doc.ref);
                count++;
                totalDeleted++;
            } else {
                console.log(`[Fix] Skipping non-realtime doc: ${doc.id} (${data.provider})`);
            }
        }

        if (count >= 400) {
            await batch.commit();
            console.log(`[Fix] Committed batch of ${count} deletions.`);
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
        console.log(`[Fix] Committed final batch of ${count} deletions.`);
    }

    console.log(`[Fix] Done. Total deleted: ${totalDeleted}`);
}

fixBadEod().catch(console.error);
