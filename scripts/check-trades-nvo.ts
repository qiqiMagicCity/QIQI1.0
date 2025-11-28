
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

async function checkTrades() {
    console.log(`Checking 'trades' collection for user ${uid}...`);

    const tradesRef = db.collection(`users/${uid}/trades`);
    const snapshot = await tradesRef.get();

    console.log(`Found ${snapshot.size} records in 'trades'.`);

    const nvoCandidates: any[] = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const symbol = data.symbol || data.ticker || data.underlying; // Check aliases

        if (symbol && typeof symbol === 'string' && symbol.trim().toUpperCase() === 'NVO') {
            nvoCandidates.push({ id: doc.id, ...data, source: 'trades' });
        }
    });

    console.log(`Found ${nvoCandidates.length} NVO records in 'trades':`);
    nvoCandidates.forEach(tx => {
        console.log(JSON.stringify(tx, null, 2));
    });
}

checkTrades().catch(console.error);
