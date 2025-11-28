
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

const app = admin.app();
console.log('Connected to Project ID:', app.options.projectId);

const db = getFirestore();

async function checkUsers() {
    console.log('Checking users collection...');
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
        console.log('Users collection is empty (no documents).');
    } else {
        console.log(`Found ${snapshot.size} user documents.`);
        snapshot.docs.forEach(doc => console.log(`User ID: ${doc.id}`));
    }
}

checkUsers().catch(console.error);
