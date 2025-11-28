import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

// Ensure admin is initialized
if (!admin.apps.length) {
    admin.initializeApp();
}

export const saveRealTimeEod = onCall(
    { region: "us-central1" },
    async (request) => {
        const { auth, data } = request;

        // 1. Auth check
        if (!auth?.uid) {
            throw new HttpsError("unauthenticated", "User must be logged in.");
        }

        // 2. Validate input
        const date = String(data?.date ?? "").trim();
        const symbol = String(data?.symbol ?? "").trim().toUpperCase();
        const price = Number(data?.price);

        if (!date || !symbol || isNaN(price)) {
            throw new HttpsError("invalid-argument", "Missing date, symbol, or valid price.");
        }

        const docId = `${date}_${symbol}`;
        const db = admin.firestore();

        try {
            // 3. Write to Firestore (Admin SDK bypasses rules)
            await db.collection("officialCloses").doc(docId).set({
                symbol,
                date,
                tradingDate: date,
                close: price,
                status: "ok",
                provider: "realtime_snapshot_manual",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                savedBy: auth.uid
            });

            logger.info(`[saveRealTimeEod] Saved ${symbol} on ${date}: ${price} by ${auth.uid}`);
            return { success: true, docId };
        } catch (error: any) {
            logger.error(`[saveRealTimeEod] Failed to save ${docId}`, error);
            throw new HttpsError("internal", "Failed to write to database.");
        }
    }
);
