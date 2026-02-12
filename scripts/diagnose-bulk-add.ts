
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, writeBatch, increment, serverTimestamp, setDoc } from 'firebase/firestore';
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

async function diagnoseBulkAdd() {
    const uid = "test-user-diag";
    console.log(`=== Diagnostics for Bulk Add (User: ${uid}) ===`);

    const token = await admin.auth().createCustomToken(uid);
    await signInWithCustomToken(auth, token);
    console.log("Logged in with " + uid);

    // Ensure user doc exists for update test
    await admin.firestore().doc(`users/${uid}`).set({
        name: "Test User",
        // NO 'id' field here to test the theory
        txRevision: 0
    });
    console.log("Prepared user doc (without 'id' field).");

    const batch = writeBatch(db);

    // Path 1: Transaction create
    const txId = "diag-tx-1";
    const txRef = doc(db, 'users', uid, 'transactions', txId);
    batch.set(txRef, { symbol: 'AAPL', quantity: 10, price: 150, userId: uid });
    console.log(`Added doc: ${txRef.path} (SET)`);

    // Path 2: User update
    const userRef = doc(db, 'users', uid);
    batch.update(userRef, {
        txRevision: increment(1),
        updatedAt: serverTimestamp()
    });
    console.log(`Added doc: ${userRef.path} (UPDATE)`);

    console.log("\nCommitting batch...");
    try {
        await batch.commit();
        console.log("✅ Batch committed successfully? (Unexpected for this test)");
    } catch (e: any) {
        console.log("\n❌ BATCH FAILED");
        console.log("Error Code: " + e.code);
        console.log("Error Message: " + e.message);

        if (e.code === 'permission-denied') {
            console.log("\n--- Path Isolation Diagnostics ---");
            console.log("Retrying operations individually to find the culprit...");

            try {
                await setDoc(txRef, { symbol: 'AAPL', quantity: 10, price: 150, userId: uid });
                console.log("✅ Operation Success: SET " + txRef.path);
            } catch (e1: any) {
                console.log("❌ Operation DENIED: SET " + txRef.path);
            }

            try {
                // Use setDoc with merge for update simulation if we don't want to use update() helper
                await setDoc(userRef, { txRevision: 1 }, { merge: true });
                console.log("✅ Operation Success: UPDATE " + userRef.path);
            } catch (e1: any) {
                console.log("❌ Operation DENIED: UPDATE " + userRef.path);
            }
        }
    }

    await signOut(auth);
}

diagnoseBulkAdd().catch(err => {
    console.error(err);
    process.exit(1);
});
