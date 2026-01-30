
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// --- CONFIGURATION ---
// REPLACE THIS with the User ID found in the error logs!
// From recent logs: fqbkSoyuAKQ4JDG13KaMKMHK9Ep2
const TARGET_USER_ID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

// The IDs of the 3 "Ghost" transactions that refuse to be deleted
// From logs: 921db... etc. (We will query them by date/symbol to be sure if full ID is not handy)
// Or better, we just delete the known fragments.
const TARGET_SYMBOL = 'NFLX';
const TARGET_QUANTITIES = [237, 1, 95];

// Initialize Admin SDK
// Try to find service account key, or use default credentials
// For local emulator, we can just init with projectId
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

try {
    admin.initializeApp({
        projectId: 'demo-project' // Typical emulator project ID
    });
} catch (e) {
    console.log("App already initialized or init error:", e);
}

const db = admin.firestore();

async function main() {
    console.log(`Searching for ghost transactions for user: ${TARGET_USER_ID}`);
    console.log(`Symbol: ${TARGET_SYMBOL}, Quantities: ${TARGET_QUANTITIES.join(', ')}`);

    const transactionsRef = db.collection('users').doc(TARGET_USER_ID).collection('transactions');

    // We fetch ALL transactions for this symbol to avoid missing anything
    const snapshot = await transactionsRef
        .where('symbol', '==', TARGET_SYMBOL)
        .get();

    if (snapshot.empty) {
        console.log('No transactions found for this user/symbol.');
        return;
    }

    console.log(`Found ${snapshot.size} transactions for ${TARGET_SYMBOL}. Scanning for targets...`);

    let deletedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const qty = Number(data.quantity);
        const type = data.type; // SELL, BUY

        // Identify the ghost fragments
        if (TARGET_QUANTITIES.includes(qty)) {
            console.log(`[TARGET ACQUIRED] ID: ${doc.id} | ${type} ${qty} @ ${data.price} | Date: ${data.transactionDateNy}`);

            try {
                // FORCE DELETE using Admin SDK (Bypasses Rules)
                await doc.ref.delete();
                console.log(` -> 💥 DELETED SUCCESSFULLY!`);
                deletedCount++;
            } catch (err) {
                console.error(` -> ❌ FAILED TO DELETE:`, err);
            }
        } else {
            console.log(`[Safe] ID: ${doc.id} | ${type} ${qty} (Not a target)`);
        }
    }

    console.log('---------------------------------------------------');
    console.log(`Operation Complete. Deleted ${deletedCount} ghost records.`);
    console.log('Please refresh your dashboard and verify.');
}

main().catch(console.error);
