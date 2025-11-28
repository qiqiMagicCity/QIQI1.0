
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'studio-9804216494-c2b75';

if (!admin.apps.length) {
    try {
        admin.initializeApp({ projectId });
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

const db = getFirestore();

async function findUid() {
    console.log('Trying to find a UID via collectionGroup...');

    try {
        // Try to get just 1 transaction from ANY user
        const snapshot = await db.collectionGroup('transactions').limit(1).get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            console.log('Found a transaction!');
            console.log('Path:', doc.ref.path);

            // Path should be users/{uid}/transactions/{txId}
            const segments = doc.ref.path.split('/');
            if (segments.length >= 2 && segments[0] === 'users') {
                const uid = segments[1];
                console.log('Found User ID:', uid);

                // Now check this user for NVO
                await checkUserForNvo(uid);
            }
        } else {
            console.log('No transactions found in the entire database.');

            // Try 'trades' collection group
            const tradesSnap = await db.collectionGroup('trades').limit(1).get();
            if (!tradesSnap.empty) {
                const doc = tradesSnap.docs[0];
                console.log('Found a trade!');
                console.log('Path:', doc.ref.path);
                const segments = doc.ref.path.split('/');
                if (segments.length >= 2 && segments[0] === 'users') {
                    const uid = segments[1];
                    console.log('Found User ID:', uid);
                    await checkUserForNvo(uid);
                }
            } else {
                console.log('No trades found either.');
            }
        }
    } catch (e) {
        console.error('Error querying collectionGroup:', e);
    }
}

async function checkUserForNvo(uid: string) {
    console.log(`Checking user ${uid} for NVO...`);
    const transactionsRef = db.collection(`users/${uid}/transactions`);
    const tradesRef = db.collection(`users/${uid}/trades`);

    const txSnap = await transactionsRef.where('symbol', '==', 'NVO').get();
    const tradeSnap = await tradesRef.where('symbol', '==', 'NVO').get();

    console.log(`Found ${txSnap.size} NVO transactions.`);
    console.log(`Found ${tradeSnap.size} NVO trades.`);

    if (txSnap.size > 0) {
        txSnap.docs.forEach(d => console.log('Tx:', d.data()));
    }
    if (tradeSnap.size > 0) {
        tradeSnap.docs.forEach(d => console.log('Trade:', d.data()));
    }
}

findUid().catch(console.error);
