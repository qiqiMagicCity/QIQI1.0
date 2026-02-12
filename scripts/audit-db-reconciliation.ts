
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "measurementId": "",
    "messagingSenderId": "7191046993"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function normalizeSymbolForAudit(s: string): string {
    // Simulate client-side normalization
    return s.trim().toUpperCase();
}

const auditPairs = [
    { date: '2026-01-02', symbol: 'MSFT' },
    { date: '2026-01-02', symbol: 'AAPL' },
    { date: '2026-01-02', symbol: 'NVDA' },
    { date: '2026-01-02', symbol: 'NKE260109C65' },
    { date: '2026-01-05', symbol: 'MSFT' },
    { date: '2026-01-05', symbol: 'NKE260109C65' },
    { date: '2026-01-06', symbol: 'TSLA' },
    { date: '2026-01-06', symbol: 'NKE260109C65' },
    { date: '2026-01-02', symbol: '  nvda  ' }, // Testing normalization
    { date: '2026-02-06', symbol: 'AAPL' }
];

async function runReconciliation() {
    console.log('--- [Step 1 Audit] DB Reconciliation ---');
    console.log('Target Collection: officialCloses');
    console.log('----------------------------------------');

    let existCount = 0;
    let totalCount = auditPairs.length;

    for (const pair of auditPairs) {
        const raw = pair.symbol;
        const norm = normalizeSymbolForAudit(raw);
        const docId = `${pair.date}_${norm}`;

        try {
            const docRef = doc(db, 'officialCloses', docId);
            const snap = await getDoc(docRef);

            console.log(`Key: ${docId.padEnd(25)} | Raw: ${raw.padEnd(10)} | Norm: ${norm.padEnd(10)}`);
            if (snap.exists()) {
                const data = snap.data();
                console.log(`  -> Status: EXISTS | close: ${data.close} | repo_status: ${data.status} | sym_stored: ${data.symbol}`);
                existCount++;
            } else {
                console.log(`  -> Status: MISSING (Not found in DB)`);
            }
        } catch (e: any) {
            console.log(`  -> Error querying ${docId}: ${e.message}`);
        }
    }

    console.log('----------------------------------------');
    console.log(`Summary: Found ${existCount} out of ${totalCount} keys in DB.`);
    console.log(`Audit Conclusion: ${existCount === 0 ? 'True Missing (Most pairs)' : existCount === totalCount ? 'All False Missing (Client logic issue)' : 'Mixed Status'}`);
}

runReconciliation().catch(console.error);
