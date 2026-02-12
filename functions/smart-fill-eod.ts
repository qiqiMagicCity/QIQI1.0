
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

const TARGET_SYMBOL = 'NKE260109C65';
// Also cover the spaced version just in case
const TARGET_SYMBOL_SPACED = 'NKE 260109 C 65';

async function run() {
    console.log(`=== Smart Fill EOD for ${TARGET_SYMBOL} based on User Transactions ===`);

    // 1. Find the transaction to get the price
    const usersSnap = await db.collection('users').get();
    let txFound: any = null;
    let txDate = '';

    console.log(`Scanning ${usersSnap.size} users...`);

    for (const userDoc of usersSnap.docs) {
        const txSnap = await userDoc.ref.collection('transactions').get();
        // Check trades too if needed, but screenshot implies regular transaction

        txSnap.forEach(doc => {
            const d = doc.data();
            // Normalize symbol check
            const s = (d.symbol || '').replace(/\s+/g, '');
            if (s === TARGET_SYMBOL) {
                console.log(`Found Transaction in user ${userDoc.id}: ${d.date} ${d.type} Price: ${d.price}`);

                // We want the earliest one (STO likely)
                if (!txFound || d.date < txDate) {
                    txFound = d;
                    txDate = d.date; // YYYY-MM-DD string hopefully
                }
            }
        });
    }

    if (!txFound) {
        console.warn("No transactions found for this symbol. Cannot fetch price.");
        return;
    }

    const price = Number(txFound.price);
    if (!price || isNaN(price)) {
        console.warn("Transaction price is invalid:", txFound.price);
        return;
    }

    console.log(`Best Source: Date=${txDate}, Price=${price}`);

    // 2. Write to Official Closes
    // Date Format Check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
        console.warn("Date format invalid:", txDate);
        return;
    }

    const docId = `${txDate}_${TARGET_SYMBOL}`;
    console.log(`Writing to officialCloses/${docId}...`);

    await db.collection('officialCloses').doc(docId).set({
        status: 'ok',
        close: price,
        symbol: TARGET_SYMBOL,
        date: txDate,
        tradingDate: txDate,
        provider: 'transaction_fill',
        note: 'Filled from user transaction',
        retrievedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log("Success.");
}

run();
