
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { getAuth } from 'firebase/auth'; // Not strictly needed for admin script but keeping structure similar
import dotenv from 'dotenv';
import fs from 'fs';

// Load env
dotenv.config({ path: '.env.local' });

const firebaseConfig = {
    apiKey: "fake-api-key",
    projectId: "firebase-studio-1761782845873",
};

// Initialize
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Use Emulator
import { connectFirestoreEmulator } from 'firebase/firestore';
connectFirestoreEmulator(db, '127.0.0.1', 8080);

const UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';
const ZOMBIE_IDS = [
    'ILw90KswCnhGyHNmQN30',
    '20ZaDmup1rNb168nvFCn',
    'xouoG3VkUouSqwGka3Aj'
];

async function inspectZombies() {
    console.log('🧟 Inspecting Zombies...');
    console.log(`User: ${UID}`);

    for (const id of ZOMBIE_IDS) {
        console.log(`\n🔍 Checking ID: ${id}`);
        let found = false;

        // Check transactions
        const txRef = doc(db, 'users', UID, 'transactions', id);
        const txSnap = await getDoc(txRef);
        if (txSnap.exists()) {
            console.log(`✅ Found in [transactions] collection:`);
            console.log(JSON.stringify(txSnap.data(), null, 2));
            found = true;
        }

        // Check trades
        const trRef = doc(db, 'users', UID, 'trades', id);
        const trSnap = await getDoc(trRef);
        if (trSnap.exists()) {
            console.log(`✅ Found in [trades] collection:`);
            console.log(JSON.stringify(trSnap.data(), null, 2));
            found = true;
        }

        if (!found) {
            console.log('❌ Not found in either collection (or maybe permissions issue?)');
        }
    }
}

inspectZombies().catch(console.error).then(() => {
    // Keep alive briefly for console flush then exit
    setTimeout(() => process.exit(0), 1000);
});
