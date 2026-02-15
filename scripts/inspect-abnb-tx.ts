
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../src/firebase/config';

if (!admin.apps.length) {
    try {
        const serviceAccount = require('../service-account-key.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
    } catch (e) {
        admin.initializeApp({ projectId: firebaseConfig.projectId });
    }
}
const db = getFirestore();
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';
const TX_ID = 'hr7X8sm5ybNi9fwvzhRv';

async function inspect() {
    console.log(`\n=== Inspecting Transaction ${TX_ID} ===`);
    const docRef = db.collection('users').doc(TARGET_UID).collection('transactions').doc(TX_ID);
    const doc = await docRef.get();

    if (!doc.exists) {
        console.log("Transaction not found!");
        return;
    }

    const data = doc.data() as any;
    console.log(JSON.stringify(data, null, 2));

    console.log(`\n--- Critical Fields Analysis ---`);
    console.log(`Symbol: ${data.symbol}`);
    console.log(`AssetType: ${data.assetType}`); // Check if it says 'option'
    console.log(`Multiplier: ${data.multiplier}`); // Check if it says 100
    console.log(`Qty: ${data.qty || data.quantity}`);
    console.log(`Price: ${data.price}`);

    // Check Holding Config
    console.log(`\n=== Inspecting Holding Config (ABNB) ===`);
    const holdingRef = db.collection('users').doc(TARGET_UID).collection('holdings').doc('ABNB');
    const hSnap = await holdingRef.get();
    if (hSnap.exists) {
        console.log(JSON.stringify(hSnap.data(), null, 2));
    } else {
        console.log("No holding config doc found for ABNB.");
    }
}

inspect().catch(console.error);
