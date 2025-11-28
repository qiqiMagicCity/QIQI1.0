
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

async function checkUsers() {
    console.log('Checking users collection...');
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
        console.log('Users collection is empty (no documents).');
        // Check if we can list subcollections of a known user ID if we had one?
        // But we don't have one.
    } else {
        console.log(`Found ${snapshot.size} user documents.`);
        snapshot.docs.forEach(doc => console.log(`User ID: ${doc.id}`));
    }
}

checkUsers().catch(console.error);
