
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75", // Verified from src/firebase/config.ts
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const testDocs = [
    '2026-01-02_NKE260109C65',
    '2026-01-06_GGLL',
    '2026-01-22_AAPL',
    '2026-01-06_GOOGL' // Added to check if GGLL is a typo
];

async function runAudit() {
    console.log('--- [Step 1] Firebase Config & Environment ---');
    console.log('ProjectId:', firebaseConfig.projectId);
    console.log('Environment: (Simulated Audit Environment)');
    console.log('Time (UTC):', new Date().toISOString());

    console.log('\n--- [Step 2 & 3] Document Queries (Permissions & Presence) ---');
    for (const id of testDocs) {
        try {
            console.log(`Checking docId: [${id}]`);
            const snap = await getDoc(doc(db, 'officialCloses', id));
            if (snap.exists()) {
                const data = snap.data();
                console.log(`  -> EXISTS: true`);
                console.log(`  -> status: ${data.status}`);
                console.log(`  -> close: ${data.close}`);
                console.log(`  -> updatedAt: ${data.updatedAt?.toDate() || 'N/A'}`);
                console.log(`  -> symbolStored: ${data.symbol || 'N/A'}`);
            } else {
                console.log(`  -> EXISTS: false`);
            }
        } catch (err: any) {
            console.error(`  -> ERROR: ${err.code} | ${err.message}`);
        }
        console.log('---');
    }

    console.log('\n--- [Step 4] Normalization Test ---');
    const symbols = ['NKE260109C65', ' GGLL ', 'AAPL', 'nike260109c65'];
    symbols.forEach(s => {
        const norm = s.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
        console.log(`Raw: [${s}] -> Norm: [${norm}] -> Key: [2026-01-02_${norm}]`);
    });
}

runAudit();
