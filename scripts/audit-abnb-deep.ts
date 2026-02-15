
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Setup Firebase Admin (assuming localized credential handling or emulator)
// For this script to work in the user's environment, we might need to assume 
// the environment is already set up or try to read a service account if available.
// However, since I cannot easily authenticate, I will try to read the local cache/json files first 
// OR simpler: I will create a script that runs a "dry run" audit on the provided transaction data 
// if I can find where the data is stored.

// Wait, the user has "scripts" folder. I should check if there are existing audit scripts I can repurpose.
// The user mentions "transactions collection".

// Let's write a script to query Firestore for 'transactions' and 'snapshots' for ABNB.
// I'll assume the standard firebase admin setup exists in the project.

const serviceAccountPath = path.resolve(__dirname, '../service-account.json');
// Note: In this environment I might not have the key. 
// I will try to use the existing `src/firebase/admin.ts` or similar if it exists, but usually scripts use a local setup.

// Let's look at `scripts/audit-step2-m14-v2.ts` to see how they connect.
// It seems they import from `../src/lib/...`. 

// Better approach: I will write a script that scans ALL json files in `src/data` or `scripts` for "ABNB".
// AND I will write a script to simulate the PnL engine if I can feed it data.

// But the user wants "Real Evidence" from the DB. 
// I will create a script that uses the `firebase-admin` to query the production/emulator DB.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Try to find a service account, otherwise assume default auth (CLI)
try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    initializeApp(); // Fallback to ADC
}

const db = getFirestore();

async function auditABNB() {
    console.log('--- ABNB Audit Start ---');

    // 1. Find the User (usually the first one or specific one if known)
    // I will scan all users or a specific hardcoded one if I knew it.
    // For now, scan 'users' collection.
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        console.log(`Checking User: ${uid}`);

        // Check Transactions
        const txSnap = await db.collection(`users/${uid}/transactions`).get();
        // Also check 'trades' collection if it exists
        const tradesSnap = await db.collection(`users/${uid}/trades`).get();

        const allDocs = [...txSnap.docs, ...tradesSnap.docs];

        const abnbTxs = allDocs.filter(d => {
            const data = d.data();
            const s = (data.symbol || data.ticker || '').toUpperCase();
            // Check for ABNB or anything containing ABNB
            return s.includes('ABNB');
        }).map(d => ({ id: d.id, ...d.data() }));

        if (abnbTxs.length > 0) {
            console.log(`Found ${abnbTxs.length} ABNB transactions for user ${uid}:`);
            console.log(JSON.stringify(abnbTxs, null, 2));
        }

        // Check Snapshots
        const snapSnap = await db.collection(`users/${uid}/snapshots`).get();
        snapSnap.docs.forEach(d => {
            const data = d.data();
            if (data.inventory && data.inventory['ABNB']) {
                console.log(`Found ABNB in snapshot ${d.id} (${data.date}):`);
                console.log(JSON.stringify(data.inventory['ABNB'], null, 2));
            }
        });

        // Check Holdings
        const holdingsSnap = await db.collection(`users/${uid}/holdings`).doc('ABNB').get();
        if (holdingsSnap.exists) {
            console.log(`Found ABNB in holdings live doc:`);
            console.log(JSON.stringify(holdingsSnap.data(), null, 2));
        }
    }
    console.log('--- ABNB Audit End ---');
}

auditABNB().catch(console.error);
