
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

async function listCollections() {
    const collections = await db.listCollections();
    console.log('Collections:');
    collections.forEach(col => console.log(col.id));
}

listCollections().catch(console.error);
