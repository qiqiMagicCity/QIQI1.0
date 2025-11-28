
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

const db = getFirestore();

async function checkEod() {
    console.log('Checking NVDA EOD data...');
    const dates = ['2025-11-24', '2025-11-25'];

    for (const date of dates) {
        const docId = `${date}_NVDA`;
        const doc = await db.collection('officialCloses').doc(docId).get();
        if (doc.exists) {
            console.log(`✅ [${docId}] EXISTS:`, doc.data());
        } else {
            console.log(`❌ [${docId}] MISSING`);
        }
    }
}

checkEod().catch(console.error);
