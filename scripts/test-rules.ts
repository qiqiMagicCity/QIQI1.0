
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import * as admin from 'firebase-admin';

// Import config - we need to be careful with paths
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

async function testRules() {
    console.log("=== Firestore Rules Verification for pnlSnapshots ===");

    // 1. Generate Custom Tokens
    console.log("Generating custom tokens...");
    const tokenA = await admin.auth().createCustomToken("user-a");
    const tokenB = await admin.auth().createCustomToken("user-b");

    const monthId = "2026-02";

    // --- Case 1: User A accessing own data ---
    console.log("\n[Test 1] User A reading own snapshots...");
    await signInWithCustomToken(auth, tokenA);
    try {
        // We use a dummy ID 'user-a' 
        const ref = doc(db, 'pnlSnapshots', 'user-a', 'months', monthId);
        await getDoc(ref);
        console.log("✅ Success: User A can access own document matching their UID.");
    } catch (e: any) {
        console.log("❌ Result: Blocked? " + e.message);
    }

    // --- Case 2: User A accessing User B's data (Read) ---
    console.log("\n[Test 2] User A reading User B's snapshots...");
    try {
        const ref = doc(db, 'pnlSnapshots', 'user-b', 'months', monthId);
        await getDoc(ref);
        console.log("❌ Error: User A was able to read User B's document!");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("✅ Success: Permission Denied (Cross-user read blocked).");
        } else {
            console.log("❓ Unexpected Error: " + e.message);
        }
    }

    // --- Case 3: User A accessing User B's data (Write) ---
    console.log("\n[Test 3] User A writing User B's snapshots...");
    try {
        const ref = doc(db, 'pnlSnapshots', 'user-b', 'months', monthId);
        await setDoc(ref, { data: 'malicious-overwrite', ts: Date.now() });
        console.log("❌ Error: User A was able to write to User B's document!");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("✅ Success: Permission Denied (Cross-user write blocked).");
        } else {
            console.log("❓ Unexpected Error: " + (e.code || e.message));
        }
    }

    // --- Case 4: Regression on System Collection (Read-only) ---
    console.log("\n[Test 4] System Collections (officialCloses) write check...");
    try {
        const ref = doc(db, 'officialCloses', '2026-02-10_AAPL');
        await setDoc(ref, { price: 999999 }, { merge: true });
        console.log("❌ Error: Client was able to write to officialCloses!");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("✅ Success: System collection write blocked.");
        } else {
            console.log("❓ Unexpected Error: " + e.code);
        }
    }

    await signOut(auth);
    console.log("\n=== Rule Verification Done ===");
}

testRules().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
