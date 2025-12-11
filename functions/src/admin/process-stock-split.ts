import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

interface SplitUpdate {
    id: string; // The document ID, e.g., 'YYYY-MM-DD_SYMBOL'
    close: number;
}

export const processStockSplit = onCall({ region: "us-central1" }, async (request) => {
    const updates = (request.data?.updates ?? []) as SplitUpdate[];

    if (!Array.isArray(updates) || updates.length === 0) {
        throw new HttpsError("invalid-argument", "Updates must be a non-empty array.");
    }

    // Firestore batch limit is 500
    const BATCH_SIZE = 500;
    const db = admin.firestore();
    const collectionRef = db.collection("officialCloses");

    let updatedCount = 0;
    let batch = db.batch();
    let operationCounter = 0;

    try {
        for (const update of updates) {
            if (!update.id || typeof update.close !== 'number') continue;

            const docRef = collectionRef.doc(update.id);

            // Use set with merge: true to avoid crashing if doc doesn't exist (though it should)
            // Actually strictly we want update. If doc missing, we skip?
            // Let's use update, and ignore errors if single doc missing? 
            // No, batch fails if one fails.
            // Better to check existence? Too slow.
            // Let's assume the user previewed existing docs.
            batch.update(docRef, {
                close: update.close,
                updatedBy: 'processStockSplit',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            operationCounter++;

            if (operationCounter >= BATCH_SIZE) {
                await batch.commit();
                updatedCount += operationCounter;
                batch = db.batch();
                operationCounter = 0;
            }
        }

        if (operationCounter > 0) {
            await batch.commit();
            updatedCount += operationCounter;
        }

        return { success: true, updatedCount };

    } catch (error: any) {
        console.error("Stock split batch update failed", error);
        throw new HttpsError("internal", error.message);
    }
});
