
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

async function findNvoGlobal() {
    console.log('Searching for NVO in ALL transactions collections...');

    // Search in 'transactions' collection group
    const transactionsQuery = db.collectionGroup('transactions').where('symbol', '==', 'NVO');
    const txSnap = await transactionsQuery.get();

    if (!txSnap.empty) {
        console.log(`Found ${txSnap.size} NVO records in 'transactions' group:`);
        txSnap.docs.forEach(doc => {
            console.log(`  Path: ${doc.ref.path}, Data:`, doc.data());
        });
    } else {
        console.log("No NVO records found in 'transactions' group.");
    }

    // Search in 'trades' collection group
    const tradesQuery = db.collectionGroup('trades').where('symbol', '==', 'NVO');
    const tradesSnap = await tradesQuery.get();

    if (!tradesSnap.empty) {
        console.log(`Found ${tradesSnap.size} NVO records in 'trades' group:`);
        tradesSnap.docs.forEach(doc => {
            console.log(`  Path: ${doc.ref.path}, Data:`, doc.data());
        });
    } else {
        console.log("No NVO records found in 'trades' group.");
    }
}

findNvoGlobal().catch(console.error);
