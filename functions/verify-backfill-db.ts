import * as admin from 'firebase-admin';
import { fetchAndSaveOfficialClose } from './src/lib/close/run';
import * as fs from 'fs';

// Force Initialize Admin
if (!admin.apps.length) {
    try {
        admin.initializeApp();
        console.log("Admin initialized");
    } catch (e) {
        console.error("Admin init failed:", e);
        process.exit(1);
    }
}

async function verify() {
    const db = admin.firestore();
    const symbol = 'GGLL';
    const date = '2025-11-24';

    console.log(`\n--- Starting DB Verification for ${symbol} @ ${date} ---`);

    try {
        // Use dummy secrets
        const secrets = {
            FMP_TOKEN: "dummy_token_force_fail",
            MARKETSTACK_API_KEY: "dummy_key_force_fail",
            STOCKDATA_API_KEY: "dummy_key_force_fail"
        };

        console.log("Triggering fetchAndSaveOfficialClose...");
        // 1. Trigger the fetch/save
        const result = await fetchAndSaveOfficialClose(db, symbol, date, secrets);
        console.log("Function Result:", JSON.stringify(result, null, 2));

        if (result.status !== 'ok') {
            console.error("❌ Function executed but did not return 'ok' status.");
        }

        // 2. Verify in Firestore
        console.log("Reading from Firestore...");
        const docId = `${date}_${symbol}`;
        const docRef = db.collection('officialCloses').doc(docId);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();
            console.log("✅ Document FOUND in Firestore!");
            console.log("Doc Data:", JSON.stringify(data, null, 2));

            if (data?.status === 'ok' && data?.provider === 'yahoo' && typeof data?.close === 'number') {
                console.log("\nSUCCESS: Verification Passed. Data is correctly written from Yahoo.");
            } else {
                console.error("\n❌ FAILURE: Document exists but data is incorrect.");
            }
        } else {
            console.error("\n❌ FAILURE: Document NOT found in Firestore after write.");
        }

    } catch (e: any) {
        let msg = `\n❌ Execution Failed with Exception: ${e.message}\n`;
        if (e.cause) {
            msg += `Cause (Attempts):\n${JSON.stringify(e.cause, null, 2)}\n`;
        } else {
            const plain = {};
            Object.getOwnPropertyNames(e).forEach(key => (plain as any)[key] = (e as any)[key]);
            msg += `Full Error:\n${JSON.stringify(plain, null, 2)}\n`;
        }

        try { fs.writeFileSync('verify.log', msg); } catch (err) { console.error("Write log failed", err); }
        console.error(msg);
    }
}

verify();
