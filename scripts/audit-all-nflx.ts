
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'firebase-studio-1761782845873';

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

async function findAllNflx() {
    console.log('--- SCANNING ALL USERS FOR NFLX ---');

    const usersSnap = await db.collection('users').get();
    console.log(`Total Users Found: ${usersSnap.size}`);

    for (const userDoc of usersSnap.docs) {
        console.log(`\nUser: ${userDoc.id}`);

        // Check both legacy 'trades' and new 'transactions'
        const cols = ['transactions', 'trades'];

        for (const col of cols) {
            const snap = await userDoc.ref.collection(col).where('symbol', '==', 'NFLX').get();
            if (!snap.empty) {
                console.log(`  Collection '${col}': Found ${snap.size} NFLX records`);
                snap.forEach(doc => {
                    const d = doc.data();
                    const tsDate = new Date(d.transactionTimestamp);
                    const nyTime = tsDate.toLocaleString('en-US', { timeZone: 'America/New_York' });

                    console.log(`    [${doc.id}]`);
                    console.log(`      Side: ${d.type || d.side}`);
                    console.log(`      Qty: ${d.quantity}`);
                    console.log(`      Price: ${d.price}`);
                    console.log(`      Time: ${nyTime} (Ts: ${d.transactionTimestamp})`);
                    console.log(`      DateNy: "${d.transactionDateNy}"`);
                    console.log(`      UTC: ${tsDate.toISOString()}`);
                });
            }
        }
    }
}

findAllNflx().catch(console.error);
