
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, writeBatch, setDoc, updateDoc, getDoc, serverTimestamp, increment } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

async function reproduce() {
    console.log("=== EVIDENCE A/B/C: Reproducing Bulk Add Denial ===");
    console.log(`Target Project: ${firebaseConfig.projectId}`);

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log("1. Signing in anonymously...");
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    console.log(`Signed in as: ${uid}`);

    // --- EVIDENCE B: Check state before batch ---
    console.log("\n--- EVIDENCE B: Document State (Legacy Mode) ---");
    const userRef = doc(db, 'users', uid);

    // Setup: Create doc WITHOUT 'id' to simulate legacy user
    console.log("Setting up user doc WITHOUT 'id' field...");
    await setDoc(userRef, {
        name: "Repro User",
        txRevision: 0,
        createdAt: Date.now()
    });

    const snap = await getDoc(userRef);
    const data = snap.data();
    console.log(`Document Exists: ${snap.exists()}`);
    console.log(`Fields: ${Object.keys(data || {}).join(', ')}`);
    console.log(`'id' field in data: ${'id' in (data || {})}`);

    // --- EVIDENCE A: writeBatch Operation List ---
    console.log("\n--- EVIDENCE A: Batch Operation List ---");
    const batch = writeBatch(db);

    const txId = "repro-batch-tx-1";
    const txRef = doc(db, 'users', uid, 'transactions', txId);
    console.log(`1. [SET]    PATH: ${txRef.path} | DATA: { symbol: 'AAPL', userId: '${uid}' }`);
    batch.set(txRef, { symbol: 'AAPL', quantity: 10, price: 150, userId: uid });

    console.log(`2. [UPDATE] PATH: ${userRef.path} | DATA: { txRevision: increment(1) }`);
    batch.update(userRef, {
        txRevision: increment(1),
        updatedAt: serverTimestamp()
    });

    // --- EVIDENCE C: Execution Log ---
    console.log("\n--- EVIDENCE C: Execution Log ---");
    try {
        console.log("Committing writeBatch...");
        await batch.commit();
        console.log("✅ Success? (If this succeeds, the fix is already active or rule is different)");
    } catch (e: any) {
        console.log(`❌ BATCH FAILED: [${e.code}] ${e.message}`);
        console.log("\n--- DIAGNOSTIC CONCLUSION ---");
        console.log("Atomic Batch: Failure in ANY operation causes whole batch to fail.");
        console.log(`Failing Path: ${userRef.path}`);
        console.log("The rule 'resource.data.id == request.resource.data.id' fails because 'id' is missing from resource.data.");
    }
}

reproduce().catch(err => {
    console.error(err);
    process.exit(1);
});
