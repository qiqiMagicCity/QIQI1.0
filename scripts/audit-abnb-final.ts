
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'studio-9804216494-c2b75' });
}
const db = getFirestore();
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function audit() {
    console.log(`[AUDIT] Targeting User: ${TARGET_UID}`);

    // 1. Current Holding
    const holdingRef = db.collection('users').doc(TARGET_UID).collection('holdings').doc('ABNB');
    const hSnap = await holdingRef.get();

    if (hSnap.exists) {
        const h = hSnap.data()!;
        console.log(`[ABNB_HOLDING]`, JSON.stringify(h, null, 2));
    } else {
        console.log(`[ABNB_HOLDING] NOT FOUND`);
    }

    // 2. Transaction Check for realized PnL clues
    const txsRef = db.collection('users').doc(TARGET_UID).collection('transactions');
    const q = await txsRef.where('symbol', '==', 'ABNB').get();
    console.log(`[ABNB_TX_COUNT] ${q.size}`);

    // 3. Official Closes check (Evaluation Date)
    // We assume the valuation date is the most recent trading day, say 2026-02-13
    const date = '2026-02-13';
    const eodRef = db.collection('officialCloses').doc(`${date}_ABNB`);
    const eodSnap = await eodRef.get();
    if (eodSnap.exists) {
        console.log(`[ABNB_EOD_${date}]`, JSON.stringify(eodSnap.data(), null, 2));
    } else {
        console.log(`[ABNB_EOD_${date}] NOT FOUND`);
    }
}

audit().catch(console.error);
