
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function findAnyOption() {
    const db = getFirestore();
    console.log("Searching for any option in stockDetails...");

    const snapshot = await db.collection('stockDetails').get();
    let found = 0;
    snapshot.forEach(doc => {
        // Option symbols are long, e.g., AAPL  240621C00150000
        if (doc.id.length > 10) {
            console.log(`FOUND OPTION in stockDetails: ${doc.id}`);
            found++;
        }
    });

    if (found === 0) {
        console.log("No long symbols found in stockDetails.");

        console.log("Searching for any option in officialCloses status='missing_vendor' or 'error'...");
        const closes = await db.collection('officialCloses')
            .where('status', 'in', ['missing_vendor', 'error'])
            .limit(50)
            .get();

        closes.forEach(doc => {
            if (doc.data().symbol?.length > 10) {
                console.log(`FOUND OPTION in officialCloses: ${doc.data().symbol} (ID: ${doc.id})`);
                found++;
            }
        });
    }

    if (found === 0) {
        console.log("Searching all transactions for assetType == option...");
        const users = await db.collection('users').limit(100).get();
        for (const user of users.docs) {
            const txs = await db.collection(`users/${user.id}/transactions`).where('assetType', '==', 'option').limit(1).get();
            if (!txs.empty) {
                console.log(`FOUND OPTION in user ${user.id}: ${txs.docs[0].data().symbol}`);
                found++;
                break;
            }
        }
    }
}

findAnyOption().catch(console.error);
