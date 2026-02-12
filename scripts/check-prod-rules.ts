
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

async function testProductionRules() {
    console.log("=== [EVID] Testing Production Rules Persistence ===");
    console.log(`Target Project: ${firebaseConfig.projectId}`);

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log("1. Signing in anonymously...");
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    console.log(`UID: ${uid}`);

    const userRef = doc(db, 'users', uid);

    // Step 1: Create a doc WITHOUT 'id' field (to test robustness)
    console.log("\n[Step 1] Creating user doc WITHOUT 'id' field...");
    try {
        await setDoc(userRef, {
            name: "Test User",
            txRevision: 0,
            createdAt: Date.now()
        });
        console.log("✅ Created doc successfully.");
    } catch (e: any) {
        console.error("❌ Failed to create user doc: " + e.message);
        return;
    }

    // Step 2: Test UPDATE (the fragile point)
    console.log("\n[Step 2] Testing UPDATE txRevision on doc lacking 'id' field...");
    try {
        await updateDoc(userRef, {
            txRevision: increment(1),
            updatedAt: serverTimestamp()
        });
        console.log("✅ PRODUCTION RULES ARE ROBUST (健壮版). Success!");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("❌ PRODUCTION RULES ARE FRAGILE (脆弱版). Update denied due to missing 'id' field.");
            console.log("Evidence: Failure on update with missing ID matches the 'resource.data.id' evaluation error.");
        } else {
            console.error("❓ Unexpected failure: " + e.message);
        }
    }
}

testProductionRules().catch(err => {
    console.error(err);
    process.exit(1);
});
