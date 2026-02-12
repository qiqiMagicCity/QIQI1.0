
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function findOptionTx() {
    console.log('🔍 Searching for GOOGL transactions...');

    // Search in all users transactions without where clause to avoid index
    const snapshot = await db.collectionGroup('transactions').limit(50).get();

    console.log(`✅ Dumping ${snapshot.size} sample transactions...`);
    snapshot.forEach(doc => {
        const data = doc.data();
        // Only print GOOGL related or options
        if (data.symbol === 'GOOGL' || data.assetType === 'option' || (data.symbol && data.symbol.includes('GOOGL'))) {
            console.log('------------------------------------------------');
            console.log('Doc ID:', doc.id);
            console.log('Data:', JSON.stringify(data, null, 2));
        }
    });
}

findOptionTx().catch(console.error);
