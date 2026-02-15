
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();

async function findValue() {
    console.log("=== SEARCHING FOR QTY 555 OR PRICE 115.7263 ===");

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;

        const collections = ['transactions', 'trades'];

        for (const col of collections) {
            const snap = await db.collection(`users/${uid}/${col}`).get();
            snap.docs.forEach(doc => {
                const d = doc.data();
                const q = Math.abs(Number(d.qty || d.quantity || 0));
                const p = Number(d.price || 0);

                // Check matches
                const matchQty = Math.abs(q - 555) < 0.01;
                const matchPrice = Math.abs(p - 115.7263) < 0.01;
                const matchSym = (d.symbol || '').includes('ABNB');

                if (matchQty || matchPrice || matchSym) {
                    console.log(`\n!!! MATCH FOUND [${col}] User: ${uid} !!!`);
                    console.log(`ID: ${doc.id}`);
                    console.log(JSON.stringify(d, null, 2));

                    // If this is the one, fetch ALL ABNB for this user
                    if (matchSym) {
                        // Trigger detailed dump for this user
                        // We will do it manually after finding
                    }
                }
            });
        }
    }
}

findValue().catch(console.error);
