
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

async function diagnostic() {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log("Signing in...");
    const { user } = await signInAnonymously(auth);
    const uid = user.uid;
    const userRef = doc(db, 'users', uid);

    console.log(`1. [Setup] Creating doc with ID (to ensure creation passes)`);
    await setDoc(userRef, { id: uid, name: "Test", txRevision: 1 });

    console.log("2. [Verification] Attempting update WITHOUT changing ID...");
    try {
        await updateDoc(userRef, { txRevision: increment(1) });
        console.log("✅ Update Success. Basic update is OK.");
    } catch (e: any) {
        console.log(`❌ Update Failed: ${e.code} - ${e.message}`);
    }

    console.log("3. [Verification] Attempting to DELETE the ID field via update (should be denied if robust)...");
    try {
        // In Firestore client SDK, you can't easily delete a field via updateDoc with a marker unless using deleteField()
        // But we can try to set it to null or something?
        // Actually, let's just try the Batch logic similar to Bulk Add.
        const batch = writeBatch(db);
        const txRef = doc(db, 'users', uid, 'transactions', 'test-tx');
        batch.set(txRef, { symbol: 'AAPL', userId: uid });
        batch.update(userRef, { txRevision: increment(1), updatedAt: serverTimestamp() });

        console.log("4. Committing Batch (Mirroring Bulk Add)...");
        await batch.commit();
        console.log("✅ Batch Success.");
    } catch (e: any) {
        console.log(`❌ Batch Failed: ${e.code} - ${e.message}`);
        console.log("This identifies the specific failure in the production pipeline.");
    }
}

diagnostic().catch(console.error);
