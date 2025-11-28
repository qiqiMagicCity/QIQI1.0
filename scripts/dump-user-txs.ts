
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
const uid = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function dumpAllTxs() {
    console.log(`Dumping all transactions for user ${uid}...`);

    const transactionsRef = db.collection(`users/${uid}/transactions`);
    const snapshot = await transactionsRef.get();

    console.log(`Found ${snapshot.size} total transactions.`);

    const nvoCandidates: any[] = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const symbol = data.symbol;

        // Check if it looks like NVO (case insensitive, trimmed)
        if (symbol && typeof symbol === 'string' && symbol.trim().toUpperCase() === 'NVO') {
            nvoCandidates.push({ id: doc.id, ...data });
        } else if (symbol && typeof symbol === 'string' && symbol.toUpperCase().includes('NVO')) {
            // Catch partial matches just in case
            nvoCandidates.push({ id: doc.id, ...data, note: 'PARTIAL MATCH' });
        }
    });

    console.log(`Found ${nvoCandidates.length} NVO-related records (including potential mismatches):`);
    nvoCandidates.forEach(tx => {
        console.log(JSON.stringify(tx, null, 2));
    });
}

dumpAllTxs().catch(console.error);
