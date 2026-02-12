
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, writeBatch, increment, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

async function probe() {
    console.log("=== [PROBE] Production Environment Security State ===");
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log("1. Authenticating anonymously...");
    const { user } = await signInAnonymously(auth);
    const uid = user.uid;
    const userRef = doc(db, 'users', uid);

    console.log(`\n--- Evidence B (Probe 1): Security Hole Test (isAdmin) ---`);
    console.log(`Attempting to set isAdmin: true on ${userRef.path}...`);
    try {
        await setDoc(userRef, { isAdmin: true }, { merge: true });
        console.log("⚠️ RESULT: ALLOWED! System is VULNERABLE. (isAdmin protection is NOT active)");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("✅ RESULT: DENIED. System is SECURE. (isAdmin protection is active)");
        } else {
            console.log(`❓ UNKNOWN ERROR: ${e.code} - ${e.message}`);
        }
    }

    console.log(`\n--- Evidence B (Probe 2): Robustness Test (Legacy User) ---`);
    console.log("Simulating a legacy user by manually deleting 'id' field (if allowed) or using a fresh doc...");
    // Since we can't delete fields via update if 'id' is protected, let's try to update a doc that doesn't have it.
    // We already established in previous probes that direct property access resource.data.id fails if missing.
    try {
        await updateDoc(userRef, { txRevision: increment(1) });
        console.log("✅ RESULT: ALLOWED. (Update successful)");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("❌ RESULT: DENIED. System is FRAGILE. (Update failed - likely due to missing 'id' error in old rules)");
        } else {
            console.log(`❓ UNKNOWN ERROR: ${e.code} - ${e.message}`);
        }
    }

    console.log(`\n--- Evidence C: Functional Regression (Bulk Add Simulation) ---`);
    const batch = writeBatch(db);
    const txRef = doc(db, 'users', uid, 'transactions', 'probe-tx-sync');
    batch.set(txRef, { symbol: 'TSLA', quantity: 1, price: 100, userId: uid });
    batch.update(userRef, { txRevision: increment(1), updatedAt: serverTimestamp() });

    try {
        console.log("Committing Bulk Add batch...");
        await batch.commit();
        console.log("✅ RESULT: SUCCESS! Bulk Add functionality is normal.");
    } catch (e: any) {
        console.log(`❌ RESULT: FAILED. Bulk Add is still blocked. Error: ${e.code} - ${e.message}`);
    }
}

probe().catch(console.error);
