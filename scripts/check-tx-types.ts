
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function checkTxTypes() {
    console.log('🔍 Checking transaction asset types...');
    const snapshot = await db.collection('transactions').limit(50).get();

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Symbol: ${data.symbol}, AssetType: ${data.assetType}, Qty: ${data.quantity}`);
    });
}

checkTxTypes().catch(console.error);
