
import { initializeApp } from 'firebase/app';
import { getOfficialCloses } from '../src/lib/data/official-close-repo';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

// The official-close-repo uses initializeFirebase() internally, 
// but for npx tsx environment we need to make sure the config is available.
// Since we can't easily mock the browser's IndexedDB in node without extra libs, 
// this script will mostly exercise the Firestore fetch and mapping logic.

async function runAudit() {
    console.log('--- [Step 1 Audit] Log Injection Trace: 2026-01-06_NVDA ---');

    try {
        // Trigger the repo logic for the target symbol/date
        const results = await getOfficialCloses('2026-01-06', ['NVDA']);
        console.log('\n[Audit Result Summary]');
        console.log(JSON.stringify(results['NVDA'], null, 2));
    } catch (e: any) {
        console.error('Audit failed:', e.message);
    }
}

runAudit();
