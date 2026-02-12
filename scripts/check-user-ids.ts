
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

async function checkIds() {
    console.log("=== Checking User ID Mismatches ===");
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const usersCol = collection(db, 'users');

    try {
        const snapshot = await getDocs(usersCol);
        console.log(`Checking ${snapshot.size} users...`);
        snapshot.forEach(doc => {
            const data = doc.data();
            const docId = doc.id;
            const fieldId = data.id;
            if (fieldId && fieldId !== docId) {
                console.error(`❌ Mismatch found! Doc: ${docId}, Field ID: ${fieldId}`);
            } else if (!fieldId) {
                console.log(`⚠️ No 'id' field for doc: ${docId}`);
            } else {
                console.log(`✅ OK: ${docId}`);
            }
        });
    } catch (e: any) {
        console.error(`Failed to list users: ${e.message}`);
        console.log("Note: This script requires admin privileges or list permission on /users.");
    }
}

checkIds().catch(console.error);
