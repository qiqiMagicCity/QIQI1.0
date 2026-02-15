
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../src/firebase/config';

// Initialize Admin SDK using default credentials or config
if (!admin.apps.length) {
    try {
        const serviceAccount = require('../service-account-key.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
    } catch (e) {
        console.log("Service account not found, trying default application credentials...");
        admin.initializeApp({
            projectId: firebaseConfig.projectId
        });
    }
}
const db = getFirestore();

const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function investigate() {
    console.log(`\n==================================================`);
    console.log(`   INVESTIGATION: ABNB State Analysis (Server-Side)`);
    console.log(`   Target UID: ${TARGET_UID}`);
    console.log(`==================================================\n`);

    // E1: Snapshot Evidence
    console.log(`[E1] Snapshot Evidence (Latest 5):`);
    const snapsRef = db.collection('users').doc(TARGET_UID).collection('snapshots');
    const snapsSnapshot = await snapsRef.orderBy('date', 'desc').limit(5).get();

    if (snapsSnapshot.empty) {
        console.log("No snapshots found.");
    } else {
        snapsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const abnbInv = data.inventory ? data.inventory['ABNB'] : undefined;
            // Check array format too
            let abnbArr = undefined;
            if (Array.isArray(data.inventory)) {
                abnbArr = data.inventory.find((h: any) => h.symbol === 'ABNB');
            }

            const hasABNB = !!abnbInv || !!abnbArr;

            console.log(` - DocId: ${doc.id}`);
            console.log(`   Date: ${data.date}`);
            console.log(`   Has inventory.ABNB? ${hasABNB}`);
            if (hasABNB) {
                console.log(`   ABNB Content: ${JSON.stringify(abnbInv || abnbArr)}`);
            }
        });
    }

    // E2: Contamination check
    // If we simply found ABNB in the top 5, we have our answer.
    // If not, we might need to dig deeper, but let's see E1 first.

    // E3: Transaction Evidence (ABNB)
    console.log(`\n[E3] Transaction Evidence (ABNB):`);
    const txsRef = db.collection('users').doc(TARGET_UID).collection('transactions');
    const txsSnapshot = await txsRef.where('symbol', '==', 'ABNB').get();

    if (txsSnapshot.empty) {
        console.log("No ABNB transactions found in 'transactions' collection.");
    } else {
        txsSnapshot.docs.forEach(doc => {
            const d = doc.data();
            console.log(` - DocId: ${doc.id}`);
            console.log(`   Date: ${d.date} / TS: ${d.transactionTimestamp}`);
            console.log(`   Side: ${d.side} / Type: ${d.type}`);
            console.log(`   Qty: ${d.quantity || d.qty} @ ${d.price}`);
            console.log(`   Source: ${d.source || 'unknown'}`);
        });
    }

    // Check 'trades' collection 
    const tradesRef = db.collection('users').doc(TARGET_UID).collection('trades');
    const tradesSnapshot = await tradesRef.where('symbol', '==', 'ABNB').get();
    if (!tradesSnapshot.empty) {
        console.log(`\n[E3 Extra] Trades Collection Evidence (ABNB):`);
        tradesSnapshot.docs.forEach(doc => {
            const d = doc.data();
            console.log(` - DocId: ${doc.id} | Date: ${d.date} | Qty: ${d.quantity} | PnL: ${d.pnl}`);
        });
    } else {
        console.log(`\n[E3 Extra] No ABNB trades found in 'trades' collection.`);
    }

}

investigate().catch(console.error);
