
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Fix TS/Module execution context
const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// FORCE EMULATOR usage to match local dev environment
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'firebase-studio-1761782845873'; // Match the one in next.config or .firebaserc

if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

const db = admin.firestore();
const TARGET_USER_ID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2'; // Known from debug-nflx.ts

async function audit() {
    console.log(`Starting Audit for Date: 2025-10-21 for User: ${TARGET_USER_ID}`);

    const userRef = db.collection('users').doc(TARGET_USER_ID);

    const collections = ['transactions', 'trades'];
    for (const colName of collections) {
        console.log(`\n=== Collection: ${colName} ===`);

        // Fetch ALL for a wide range to catch ghosts
        // 2025-10-21 is target.
        // Search wide window
        const start = new Date('2025-10-20T00:00:00Z').getTime();
        const end = new Date('2025-10-23T00:00:00Z').getTime();

        const snap = await userRef.collection(colName)
            .where('transactionTimestamp', '>=', start)
            .where('transactionTimestamp', '<=', end)
            .get();

        console.log(`Found ${snap.size} docs in +/- 24h range.`);

        snap.forEach(doc => {
            const d = doc.data();
            // Specifically look for NFLX to inspect the ghosts
            if (d.symbol === 'NFLX' || d.symbol === 'TSLA' || d.symbol === 'GGLL') {
                const tsDate = new Date(d.transactionTimestamp);
                const nyTime = tsDate.toLocaleString('en-US', { timeZone: 'America/New_York' });

                console.log(`  [${d.symbol}] ID: ${doc.id}`);
                console.log(`      Side: ${d.type || d.side}, Qty: ${d.quantity}, Price: ${d.price}`);
                console.log(`      Timestamp: ${d.transactionTimestamp}`);
                console.log(`      UTC: ${tsDate.toISOString()}`);
                console.log(`      NY:  ${nyTime}`);
                console.log(`      DateNy String: "${d.transactionDateNy}"`);

                const dateStr = '2025-10-21';
                const stringMatch = d.transactionDateNy === dateStr;
                console.log(`      String Match '2025-10-21': ${stringMatch ? 'YES' : 'NO'}`);
                console.log('------------------------------------------------');
            }
        });

        // Also try to query by String ONLY to see if we missed any by Timestamp
        const snapString = await userRef.collection(colName)
            .where('transactionDateNy', '==', '2025-10-21')
            .get();

        console.log(`Query by String '2025-10-21' returned: ${snapString.size} docs`);
        if (snapString.size > snap.size) {
            console.log("WARNING: String query found MORE than timestamp range query!");
            snapString.forEach(doc => {
                // Print ones we missed
                const d = doc.data();
                if (d.transactionTimestamp < start || d.transactionTimestamp > end) {
                    console.log(`  [MISSED BY RANGE] ID: ${doc.id} Symbol: ${d.symbol} TS: ${d.transactionTimestamp}`);
                }
            });
        }
    }
}

audit().catch(console.error);
