
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, writeBatch, setDoc, updateDoc, getDoc, serverTimestamp, increment } from 'firebase/firestore';
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

async function captureEvidence() {
    console.log("=== EVIDENCE E1/E2/E3: Production Rule Version Test ===");

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    // 1. Create a "Legacy" user document using Admin SDK (bypass rules)
    const legacyUid = "legacy-user-" + Date.now();
    console.log(`Setting up legacy user (no id field): ${legacyUid}`);
    await admin.firestore().doc(`users/${legacyUid}`).set({
        name: "Legacy User",
        txRevision: 0
    });

    // 2. Sign in as that user
    const token = await admin.auth().createCustomToken(legacyUid);
    await signInWithCustomToken(auth, token);
    console.log(`Signed in as ${legacyUid}`);

    // 3. Attempt UPDATE (the fragile point)
    const userRef = doc(db, 'users', legacyUid);
    console.log("\nAttempting UPDATE txRevision on a document lacking 'id' field...");
    try {
        await updateDoc(userRef, {
            txRevision: increment(1),
            updatedAt: serverTimestamp()
        });
        console.log("✅ RESULT: ALLOWED. Production rules are ROBUST (健壮版).");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("❌ RESULT: DENIED. Production rules are FRAGILE (脆弱版).");
            console.log("Evidence: Failure on update with missing ID matches the 'resource.data.id' evaluation error.");
        } else {
            console.log(`❓ Unexpected Error: ${e.code} - ${e.message}`);
        }
    }
}

import { signInWithCustomToken } from 'firebase/auth';

captureEvidence().catch(console.error);
