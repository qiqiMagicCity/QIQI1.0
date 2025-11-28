
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Force specific project ID
const projectId = 'studio-9804216494-c2b75';

if (!admin.apps.length) {
    try {
        admin.initializeApp({ projectId });
        console.log(`Initialized with Project ID: ${projectId}`);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

const db = getFirestore();

async function checkUsers() {
    console.log('Checking users collection...');
    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.get();

        if (snapshot.empty) {
            console.log('Users collection is empty (no documents).');
        } else {
            console.log(`Found ${snapshot.size} user documents.`);
            snapshot.docs.forEach(doc => console.log(`User ID: ${doc.id}`));
        }
    } catch (e) {
        console.error('Error accessing users collection:', e);
    }
}

checkUsers().catch(console.error);
