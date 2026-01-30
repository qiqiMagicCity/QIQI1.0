
import * as admin from 'firebase-admin';

// Set emulator host explicitly
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

// Initialize (assuming local or properly env set)
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            projectId: 'demo-project'
        });
    } catch (e) { console.error(e); }
}

const db = admin.firestore();
const TARGET_USER_ID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2'; // From previous context

async function debugNflx() {
    console.log('--- DEBUGGING NFLX RECORDS ---');
    // Fetch ALL transactions for NFLX, no date filter
    const q = db.collection('users').doc(TARGET_USER_ID).collection('transactions')
        .where('symbol', '==', 'NFLX');

    const snap = await q.get();
    console.log(`Total NFLX records found: ${snap.size}`);

    snap.forEach(doc => {
        const d = doc.data();
        console.log(`ID: ${doc.id}`);
        console.log(`   DateString: "${d.transactionDateNy}"`); // Quote it to see spaces
        console.log(`   Timestamp:  ${d.transactionTimestamp}`);
        console.log(`   DateObj:    ${d.transactionTimestamp ? new Date(d.transactionTimestamp).toISOString() : 'NULL'}`);
        console.log(`   Type:       ${d.type}`);
        console.log(`   Qty:        ${d.quantity}`);
        console.log('---');
    });
}

debugNflx();
