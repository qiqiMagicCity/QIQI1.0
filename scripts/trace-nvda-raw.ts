
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function runAudit() {
    const ids = ['2026-01-02_NVDA', '2026-01-05_NVDA', '2026-01-06_NVDA'];
    for (const id of ids) {
        const snap = await getDoc(doc(db, 'officialCloses', id));
        console.log(`Doc ID: ${id}`);
        if (snap.exists()) {
            console.log('Data:', JSON.stringify(snap.data(), null, 2));
        } else {
            console.log('NOT FOUND');
        }
        console.log('---');
    }
}

runAudit();
