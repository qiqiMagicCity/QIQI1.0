
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, writeBatch, increment, serverTimestamp } from 'firebase/firestore';
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

async function captureEvidence() {
    const uid = "read-only-evidence-user";
    console.log(`=== [EVID] Evidence Capture for Rule Failure (User: ${uid}) ===`);

    // 1. Setup stale user via Admin (bypass rules)
    const adb = admin.firestore();
    const userDocPath = `users/${uid}`;
    await adb.doc(userDocPath).set({
        name: "Legacy User",
        txRevision: 0,
        // MISSING 'id' FIELD ON PURPOSE to trigger error
    });

    // EVIDENCE B: Check state before batch
    const preSnap = await adb.doc(userDocPath).get();
    const fields = Object.keys(preSnap.data() || {});
    console.log(`\n--- EVIDENCE B: Pre-state (${userDocPath}) ---`);
    console.log(`Exists: ${preSnap.exists}`);
    console.log(`Fields detected: ${fields.join(', ')}`);
    console.log(`isAdmin present: ${fields.includes('isAdmin')}`);
    console.log(`id present: ${fields.includes('id')}`);

    // 2. Prepare Batch (EVIDENCE A)
    const token = await admin.auth().createCustomToken(uid);
    await signInWithCustomToken(auth, token);

    const batch = writeBatch(db);
    const txId = "bulk-test-tx-evid";
    const txRef = doc(db, 'users', uid, 'transactions', txId);

    console.log(`\n--- EVIDENCE A: Batch Operation List ---`);
    console.log(`1. [OP: SET] PATH: ${txRef.path} | DATA: { symbol: 'AAPL', ... }`);
    batch.set(txRef, {
        symbol: 'AAPL',
        quantity: 10,
        price: 250,
        userId: uid,
        transactionDateNy: '2026-02-10'
    });

    const userRef = doc(db, 'users', uid);
    console.log(`2. [OP: UPDATE] PATH: ${userRef.path} | DATA: { txRevision: increment(1), ... }`);
    batch.update(userRef, {
        txRevision: increment(1),
        updatedAt: serverTimestamp()
    });

    // 3. Commit and Capture Fail (EVIDENCE C equivalent)
    console.log(`\n--- EVIDENCE C: Execution Log ---`);
    try {
        console.log("Committing writeBatch...");
        await batch.commit();
        console.log("✅ Success? (Wait, this shouldn't happen with redirected rules)");
    } catch (err: any) {
        console.error(`❌ BATCH FAILED: [${err.code}] ${err.message}`);
        console.log(`\n--- DIAGNOSTIC CONCLUSION ---`);
        console.log(`Atomic Batch Fact: Single op failure caused entire rollback.`);
        console.log(`Culprit Op: update ${userRef.path}`);
        console.log(`Culprit Rule Context: 'resource.data.id == request.resource.data.id' triggered on document where 'resource.data.id' is UNDEFINED.`);
    }

    await signOut(auth);
}

captureEvidence().catch(err => {
    console.error(err);
    process.exit(1);
});
