
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function findRecentOptionLocal() {
    const db = getFirestore();
    console.log("Searching for any option transaction locally...");

    // Get a few users and check their txs
    const users = await db.collection('users').limit(20).get();
    let optTx: any = null;

    for (const user of users.docs) {
        const txs = await db.collection(`users/${user.id}/transactions`).get();
        txs.forEach(doc => {
            const data = doc.data();
            if (data.assetType === 'option' || (data.symbol && data.symbol.length > 10)) {
                if (!optTx || data.transactionTimestamp > optTx.transactionTimestamp) {
                    optTx = data;
                }
            }
        });
        if (optTx) break;
    }

    if (optTx) {
        console.log(`OPTION SAMPLE:`);
        console.log(`Symbol: ${optTx.symbol}`);
        console.log(`Date: ${new Date(optTx.transactionTimestamp).toISOString()}`);
        console.log(`AssetType: ${optTx.assetType}`);
    } else {
        console.log("No options found.");
    }
}

findRecentOptionLocal().catch(console.error);
