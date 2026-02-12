
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function findOptionSamples() {
    const db = getFirestore();
    console.log("Searching for users...");

    const usersSnapshot = await db.collection('users').limit(10).get();
    for (const userDoc of usersSnapshot.docs) {
        console.log(`Checking user: ${userDoc.id}...`);
        const txs = await db.collection(`users/${userDoc.id}/transactions`)
            .where('assetType', '==', 'option')
            .limit(1)
            .get();

        if (!txs.empty) {
            const data = txs.docs[0].data();
            console.log(`FOUND OPTION for user ${userDoc.id}:`);
            console.log(`Symbol: ${data.symbol}`);
            console.log(`Date: ${new Date(data.transactionTimestamp).toISOString()}`);

            const targetDate = "2026-02-10";
            const docId = `${targetDate}_${data.symbol}`;
            const closeDoc = await db.collection('officialCloses').doc(docId).get();
            if (closeDoc.exists) {
                console.log(`EOD Status for ${docId}: ${closeDoc.data()?.status}`);
            } else {
                console.log(`EOD Document ${docId} DOES NOT EXIST.`);
            }
            return;
        }
    }
    console.log("No options found in the checked users.");
}

findOptionSamples().catch(console.error);
