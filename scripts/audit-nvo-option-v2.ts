
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function audit() {
    console.log("--- Firestore Audit Start ---");

    // 1. officialCloses/2026-02-11_NVO261218C50
    try {
        const closePath = 'officialCloses/2026-02-11_NVO261218C50';
        const closeRef = db.doc(closePath);
        const closeSnap = await closeRef.get();

        console.log(`\nPath: ${closePath}`);
        console.log(`Exists: ${closeSnap.exists}`);
        if (closeSnap.exists) {
            const data = closeSnap.data();
            console.log(`Status: ${data?.status}`);
            console.log(`Close: ${data?.close}`);
            console.log(`Provider: ${data?.provider}`);
            console.log(`Symbol: ${data?.symbol}`);
            console.log(`Date: ${data?.date}`);
            // Handle potentially different timestamp formats or omit if problematic
            console.log(`UpdatedAt (Raw): ${JSON.stringify(data?.retrievedAt)}`);
        }
    } catch (e) {
        console.error("Error reading officialCloses:", e);
    }

    // 2. stockDetails/NVO261218C50
    try {
        const detailPath = 'stockDetails/NVO261218C50';
        const detailRef = db.doc(detailPath);
        const detailSnap = await detailRef.get();

        console.log(`\nPath: ${detailPath}`);
        console.log(`Exists: ${detailSnap.exists}`);
        if (detailSnap.exists) {
            const data = detailSnap.data();
            console.log(`EodRevision: ${data?.eodRevision}`);
            console.log(`AssetType: ${data?.assetType}`);
            console.log(`UpdatedAt (Raw): ${JSON.stringify(data?.updatedAt)}`);
        } else {
            console.log("Document does not exist.");
        }
    } catch (e) {
        console.error("Error reading stockDetails:", e);
    }

    console.log("\n--- Firestore Audit End ---");
}

audit().catch(console.error);
