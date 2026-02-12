
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

async function checkRuleVersion() {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log("Signing in anonymously...");
    const { user } = await signInAnonymously(auth);
    const uid = user.uid;
    const userRef = doc(db, 'users', uid);

    console.log("1. Creating user doc with ID...");
    await setDoc(userRef, { id: uid, name: "Test User" });

    console.log("2. Attempting to update with SENSITIVE field 'isAdmin'...");
    try {
        await updateDoc(userRef, { isAdmin: true });
        console.log("⚠️ RESULT: ALLOWED. Production rules are NOT yet the robust version (Missing isAdmin protection).");
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("✅ RESULT: DENIED. Production rules ARE the robust version (Shielding isAdmin).");
        } else {
            console.log(`❓ Unexpected Error: ${e.code} - ${e.message}`);
        }
    }
}

checkRuleVersion().catch(console.error);
