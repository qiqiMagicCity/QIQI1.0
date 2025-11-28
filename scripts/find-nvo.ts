
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

async function findNvo() {
    console.log('Searching for NVO transactions across all users...');
    const usersSnap = await db.collection('users').get();

    if (usersSnap.empty) {
        console.log('No users found.');
        return;
    }

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        console.log(`Checking user: ${uid}`);

        const collections = ['transactions', 'trades'];
        for (const colName of collections) {
            const colRef = userDoc.ref.collection(colName);
            // Try to find NVO in symbol field
            const snapshot = await colRef.where('symbol', '==', 'NVO').get();

            if (!snapshot.empty) {
                console.log(`  Found ${snapshot.size} NVO records in ${colName} for user ${uid}`);
                snapshot.docs.forEach(doc => {
                    console.log(`    Doc ID: ${doc.id}, Data:`, doc.data());
                });
            } else {
                // Also check lowercase or other variations just in case
                const snapshotLower = await colRef.where('symbol', '==', 'nvo').get();
                if (!snapshotLower.empty) {
                    console.log(`  Found ${snapshotLower.size} nvo (lowercase) records in ${colName} for user ${uid}`);
                }
            }
        }
    }
    console.log('Search complete.');
}

findNvo().catch(console.error);
