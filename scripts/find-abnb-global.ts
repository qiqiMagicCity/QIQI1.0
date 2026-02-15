
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Fallback for initialization
try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();

async function globalAudit() {
    console.log("=== GLOBAL AUDIT FOR ABNB ===");

    // 1. Get All Users
    const usersSnap = await db.collection('users').get();
    console.log(`Scanning ${usersSnap.size} users...`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        process.stdout.write(`Processing ${uid} ... `);

        // Check Transactions
        const txRef = db.collection(`users/${uid}/transactions`);
        const txSnap = await txRef.get();

        let found = false;
        txSnap.docs.forEach(doc => {
            const d = doc.data();
            const s = (d.symbol || '').toUpperCase();
            // Check loosely
            if (s.includes('ABNB')) {
                console.log(`\n!!! FOUND ABNB Transaction for User ${uid} !!!`);
                console.log(JSON.stringify({ id: doc.id, ...d }, null, 2));
                found = true;
            }
            // Check for that specific timestamp: 2026-02-12 15:58:00 -> approx 1770911880000
            // Allow 1 minute window
            const ts = d.transactionTimestamp;
            if (ts > 1770911800000 && ts < 1770911940000) {
                console.log(`\n!!! FOUND TIMESTAMP MATCH for User ${uid} !!!`);
                console.log(JSON.stringify({ id: doc.id, ...d }, null, 2));
                found = true;
            }
        });

        // Check Snapshots
        if (!found) {
            const snapRef = db.collection(`users/${uid}/snapshots`);
            const snapSnap = await snapRef.get();
            snapSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.inventory) {
                    const keys = Object.keys(data.inventory).filter(k => k.includes('ABNB'));
                    if (keys.length > 0) {
                        console.log(`\n!!! FOUND ABNB SNAPSHOT for User ${uid} !!!`);
                        console.log(`Doc: ${doc.id} Date: ${data.date}`);
                        console.log(data.inventory['ABNB']);
                        found = true;
                    }
                }
            });
        }

        if (!found) process.stdout.write("Clean.\n");
    }
}

globalAudit().catch(console.error);
