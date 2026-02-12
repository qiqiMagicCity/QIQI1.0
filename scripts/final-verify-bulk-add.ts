
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, updateDoc, increment, writeBatch, setDoc } from 'firebase/firestore';
import * as admin from 'firebase-admin';

// Diagnostic script for E1, E2, E3
const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

// Initialize Admin with local environment if possible
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: firebaseConfig.projectId
    });
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function runFinalVerification() {
    console.log("=== [VERIFY] Bulk Add Permission Fix & ID Invariant ===");
    const adb = admin.firestore();

    // --- E1. a) Legacy User Trace ---
    console.log("\n[E1.a] TEST: Legacy User (No ID field) -> Update txRevision");
    const legacyUid = "legacy-user-123";
    await adb.doc(`users/${legacyUid}`).set({ name: "Legacy", txRevision: 0 }); // Bypass rules to setup

    const tokenLegacy = await admin.auth().createCustomToken(legacyUid);
    await signInWithCustomToken(auth, tokenLegacy);

    try {
        await updateDoc(doc(db, 'users', legacyUid), { txRevision: increment(1) });
        console.log("✅ TRACE ALLOWED: 'id' in resource.data is false -> Evaluation success.");
    } catch (e: any) {
        console.log("❌ TRACE DENIED: " + e.message);
    }

    // --- E1. b) Normal User Trace ---
    console.log("\n[E1.b] TEST: Normal User (Has ID field) -> Update txRevision");
    const normalUid = "normal-user-456";
    await adb.doc(`users/${normalUid}`).set({ id: normalUid, name: "Normal", txRevision: 0 });

    const tokenNormal = await admin.auth().createCustomToken(normalUid);
    await signInWithCustomToken(auth, tokenNormal);

    try {
        await updateDoc(doc(db, 'users', normalUid), { txRevision: increment(1) });
        console.log("✅ TRACE ALLOWED: resource.data.id exists and matches request.");
    } catch (e: any) {
        console.log("❌ TRACE DENIED: " + e.message);
    }

    // --- E1. c) ID Tamper Trace ---
    console.log("\n[E1.c] TEST: Hijack ID Field");
    try {
        await updateDoc(doc(db, 'users', normalUid), { id: "hacker-uid" });
        console.log("❌ FAIL: ID mutation allowed!");
    } catch (e: any) {
        console.log(`✅ TRACE DENIED: Correctly blocked ID change. Code: ${e.code}`);
    }

    // --- E3. Atomic Rollback Verification ---
    console.log("\n[E3] TEST: Atomic Batch Rollback (Poisoned Batch)");
    const poisonedBatch = writeBatch(db);

    // Valid set
    const txId = "poison-test-tx";
    const txRef = doc(db, 'users', normalUid, 'transactions', txId);
    poisonedBatch.set(txRef, { symbol: 'ROLLBACK', quantity: 999 });

    // Invalid update (tampering ID)
    poisonedBatch.update(doc(db, 'users', normalUid), { id: "poison-id" });

    try {
        console.log("Committing poisoned batch...");
        await poisonedBatch.commit();
        console.log("❌ FAIL: Poisoned batch succeeded!");
    } catch (e: any) {
        console.log(`✅ SUCCESS: Batch denied. Code: ${e.code}. Checking rollback...`);
        const snapshot = await adb.doc(`users/${normalUid}/transactions/${txId}`).get();
        if (!snapshot.exists) {
            console.log("✅ ROLLBACK VERIFIED: Transaction document was NOT created.");
        } else {
            console.log("❌ ROLLBACK FAILED: Transaction document exists!");
        }
    }

    await signOut(auth);
}

runFinalVerification().catch(err => {
    console.error(err);
    process.exit(1);
});
