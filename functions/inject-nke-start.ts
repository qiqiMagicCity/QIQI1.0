
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

async function run() {
    console.log("=== Manual Injection for NKE260109C65 ===");

    // Data from User Screenshot
    const data = {
        date: '2026-01-02',
        symbol: 'NKE260109C65',
        price: 0.32
    };

    const docId = `${data.date}_${data.symbol}`;

    await db.collection('officialCloses').doc(docId).set({
        status: 'ok',
        close: data.price,
        symbol: data.symbol,
        date: data.date,
        tradingDate: data.date,
        provider: 'manual_screenshot_recovery',
        note: 'Recovered from user transaction screenshot',
        retrievedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Injected ${docId} with price ${data.price}`);

    // Also inject 0.00 for the expiration date if needed?
    // Screenshot shows 2026-01-29 trade relative to expiry? 
    // Wait, expiry is 260109 (Jan 09, 2026).
    // The user screenshot shows "2026-01-29" transaction for "NKE260109C65".
    // Wait... 260109 means Expiry is Jan 09, 2026.
    // Why is there a transaction on Jan 29, 2026 ???
    // 20 days AFTER expiry?
    // "NKE 260109 C 65" -> YYMMDD = 26 01 09.
    // Buying back 20 days late? Or is it year-month-day? 
    // Standard option symbol YY MM DD. 2026 Jan 09.
    // Maybe the user's simulation time is weird, or maybe it was assigned late?
    // But usually options disappear after expiry.
    // Let's stick to fixing the EOD gap first.
}

run();
