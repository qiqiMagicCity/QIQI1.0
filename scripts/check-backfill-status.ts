
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function checkStatus() {
    console.log('Checking system/backfill_status document...');
    const docRef = db.collection('system').doc('backfill_status');
    const doc = await docRef.get();

    if (!doc.exists) {
        console.log('❌ Document does not exist!');
    } else {
        console.log('✅ Document exists:');
        console.log(JSON.stringify(doc.data(), null, 2));
    }
}

checkStatus().catch(console.error);
