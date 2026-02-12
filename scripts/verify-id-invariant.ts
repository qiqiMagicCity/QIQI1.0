
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, updateDoc, setDoc, writeBatch, increment } from 'firebase/firestore';
import * as admin from 'firebase-admin';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

if (!admin.apps.length) {
    admin.initializeApp();
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function verifyIdInvariant() {
    console.log("=== Firestore Rules Verification: ID Invariant & Backward Compatibility ===");

    // Setup users with Admin SDK (to bypass rules for setup)
    const adb = admin.firestore();
    await adb.doc('users/old-user').set({ name: "Old User", txRevision: 10 }); // No 'id' field
    await adb.doc('users/new-user').set({ id: "new-user", name: "New User", txRevision: 10 }); // Has 'id' field
    console.log("Setup: 'old-user' (no id field) and 'new-user' (with id field) ready.");

    const tokenOld = await admin.auth().createCustomToken("old-user");
    const tokenNew = await admin.auth().createCustomToken("new-user");

    // --- Case A: Backward Compatibility (No id field in doc) ---
    console.log("\n[Test A] Old user (no id doc) incrementing txRevision...");
    await signInWithCustomToken(auth, tokenOld);
    try {
        await updateDoc(doc(db, 'users', 'old-user'), { txRevision: increment(1) });
        console.log("✅ ALLOWED: Successfully updated doc without 'id' field.");
    } catch (e: any) {
        console.log("❌ DENIED: Failed to update doc without 'id'. " + e.message);
    }

    // --- Case B: ID Mutation (Forbidden) ---
    console.log("\n[Test B] New user (with id doc) attempting to change id...");
    await signInWithCustomToken(auth, tokenNew);
    try {
        await updateDoc(doc(db, 'users', 'new-user'), { id: "hijacked-id" });
        console.log("❌ FAILED: User was able to change their ID!");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("✅ DENIED: Correctly blocked change to 'id' field.");
        } else {
            console.log("❓ Unexpected error: " + e.message);
        }
    }

    // --- Case C: Batch Write Simulation (Bulk Add) ---
    console.log("\n[Test C] Simulating Bulk Add Batch Write...");
    const batch = writeBatch(db);
    // 1. New Transaction
    const txRef = doc(db, 'users', 'new-user', 'transactions', 'test-tx-batch');
    batch.set(txRef, { symbol: 'TSLA', quantity: 1, price: 200, userId: 'new-user' });
    // 2. User Revision update
    batch.update(doc(db, 'users', 'new-user'), { txRevision: increment(1) });

    try {
        await batch.commit();
        console.log("✅ ALLOWED: Batch write (tx + revision) succeeded.");
    } catch (e: any) {
        console.log("❌ DENIED: Batch write failed. " + e.message);
    }

    await signOut(auth);
    console.log("\n=== Rule Verification Complete ===");
}

verifyIdInvariant().catch(err => {
    console.error(err);
    process.exit(1);
});
