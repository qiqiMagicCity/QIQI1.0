
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

async function count() {
    console.log('Counting transactions...');
    const snap = await db.collectionGroup('transactions').get();
    console.log('Count:', snap.size);
}
count().catch(console.error);
