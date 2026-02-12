
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

async function run() {
    console.log("=== Audit Full History Start ===");

    // 1. Get All Transactions to find Min Date
    const usersSnap = await db.collection('users').get();
    let minDate = '9999-99-99';
    let allSymbols = new Set<string>();

    for (const userDoc of usersSnap.docs) {
        const txSnap = await userDoc.ref.collection('transactions').get();
        txSnap.forEach(doc => {
            const d = doc.data();
            if (d.date && d.date < minDate) minDate = d.date;
            if (d.symbol) allSymbols.add(d.symbol);
        });
    }

    console.log(`Earliest Transaction Date: ${minDate}`);
    console.log(`Total Unique Symbols: ${allSymbols.size}`);

    // 2. Check NIO specifically
    const nioSym = 'NIO260618P3.5'; // As reported by user
    // Also try standard format just in case
    // 260618 = 2026-06-18. P = Put. 3.5 = 00003500
    const nioStandard = 'NIO260618P00003500';

    console.log(`\nChecking Specific Missing Dates for ${nioSym} / ${nioStandard}`);
    const targets = ['2025-11-03', '2025-11-04'];

    for (const date of targets) {
        const id1 = `${date}_${nioSym}`;
        const id2 = `${date}_${nioStandard}`;

        const doc1 = await db.collection('officialCloses').doc(id1).get();
        const doc2 = await db.collection('officialCloses').doc(id2).get();

        console.log(`[${date}] ${nioSym}: ${doc1.exists ? 'FOUND ' + doc1.data()?.close : 'MISSING'}`);
        console.log(`[${date}] ${nioStandard}: ${doc2.exists ? 'FOUND ' + doc2.data()?.close : 'MISSING'}`);
    }

    // 3. Dump recent history of this symbol to see where it stopped
    console.log(`\nChecking surrounding dates for ${nioSym}...`);
    const historySnap = await db.collection('officialCloses')
        .where('symbol', 'in', [nioSym, nioStandard])
        .where('date', '>=', '2025-10-30') // Look around the missing dates
        .where('date', '<=', '2025-11-10')
        .orderBy('date')
        .get();

    historySnap.forEach(doc => {
        const d = doc.data();
        console.log(`Record: ${d.date} | ${d.symbol} | Close: ${d.close}`);
    });
}

run();
