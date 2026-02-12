
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

async function diagnose() {
    console.log("=== PnL DATA VOID DIAGNOSTIC: 2025-11 ===");

    const targetDate = '2025-11-03';
    const testSymbols = ['AMZN', 'META', 'GOOGL260918C150', 'XLU'];

    console.log(`\n1. CHECK Firestore (officialCloses) for ${targetDate}`);
    for (const sym of testSymbols) {
        const docId = `${targetDate}_${sym}`;
        const doc = await db.collection('officialCloses').doc(docId).get();
        if (doc.exists) {
            const data = doc.data();
            console.log(`✅ ${docId}: FOUND. Price=$${data?.close}, Status=${data?.status}, Provider=${data?.provider}`);
        } else {
            console.log(`❌ ${docId}: NOT FOUND in Firestore.`);
        }
    }

    console.log(`\n2. CHECK User Transactions (fqbkSoyuAKQ4JDG13KaMKMHK9Ep2 - QIQI1.0)`);
    // I recall this UID from previous logs, but let me check if it's the right one.
    // Or check all users.
    const userDocs = await db.collection('users').get();
    for (const userDoc of userDocs.docs) {
        const uid = userDoc.id;
        const txSnap = await userDoc.ref.collection('transactions').get();
        const txs = txSnap.docs.map(d => ({ ...d.data(), id: d.id }));

        console.log(`User ${uid}: Found ${txs.length} transactions.`);

        for (const sym of testSymbols) {
            const symTxs = txs.filter((t: any) => (t.symbol || '').toUpperCase() === sym)
                .sort((a: any, b: any) => (a.transactionTimestamp || 0) - (b.transactionTimestamp || 0));

            if (symTxs.length === 0) continue;

            // Calculate qty on targetDate
            let qty = 0;
            for (const t of symTxs as any[]) {
                const dateAtTx = new Date(t.transactionTimestamp).toISOString().split('T')[0];
                if (dateAtTx > targetDate) break;

                let q = t.quantity || 0;
                const type = (t.type || t.side || '').toUpperCase();
                if (type.includes('SELL') || type.includes('SHORT') || type.includes('STC') || type.includes('STO')) {
                    qty -= Math.abs(q);
                } else {
                    qty += Math.abs(q);
                }
            }
            if (Math.abs(qty) > 0.0001) {
                console.log(`   - ${sym}: ACTIVE (Qty=${qty.toFixed(2)}) on ${targetDate}`);
            }
        }
    }
}

diagnose().catch(console.error);
