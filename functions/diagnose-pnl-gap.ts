
import * as admin from 'firebase-admin';

// Initialize Firebase
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Interfaces matching frontend logic
interface Tx {
    symbol: string;
    transactionTimestamp: number;
    type: 'BUY' | 'SELL';
    quantity: number;
}

async function diagnosePnLGap() {
    process.stdout.write('🔍 DIAGNOSING PNL CALENDAR GAPS (Frontend Simulation)...\n');

    // 1. Get User Transactions
    const users = await db.collection('users').listDocuments();
    if (users.length === 0) {
        console.log('No users found.');
        process.exit(0);
    }
    const user = users[0]; // Assume single user or primary user
    console.log(`Checking User: ${user.id}`);

    const txSnap = await user.collection('transactions').get();
    const transactions: Tx[] = [];
    txSnap.forEach(doc => {
        const d = doc.data();
        transactions.push({
            symbol: (d.symbol || '').toUpperCase().trim(),
            transactionTimestamp: d.transactionTimestamp,
            type: d.type,
            quantity: Number(d.quantity) || 0
        });
    });
    console.log(`Loaded ${transactions.length} transactions.`);

    // 2. Identify Holdings for Oct 24, 2025 (One of the problematic days)
    const TARGET_DATE = '2025-10-24';
    // Frontend Logic: "txDay <= date"
    // We need to match frontend's "toNyCalendarDayString" roughly.
    // Assuming timestamps are standard millis.

    const holdings = new Map<string, number>();

    transactions.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    for (const tx of transactions) {
        // Simple NY Date conversion simulation
        // (Date extraction without complex timezone lib, assuming simple ISO for diagnostic)
        const dateStr = new Date(tx.transactionTimestamp).toISOString().split('T')[0]; // UTC day roughly matches

        if (dateStr <= TARGET_DATE) {
            const qty = tx.type === 'BUY' ? tx.quantity : -tx.quantity;
            const cur = holdings.get(tx.symbol) || 0;
            holdings.set(tx.symbol, cur + qty);
        }
    }

    // Filter for active holdings (net qty > 0)
    const activeSymbols = Array.from(holdings.entries())
        .filter(([_, qty]) => Math.abs(qty) > 0.0001)
        .map(([sym]) => sym);

    console.log(`\n📅 ACTIVE HOLDINGS on ${TARGET_DATE}: ${activeSymbols.length} symbols`);
    console.log(activeSymbols.join(', '));

    // 3. Check officialCloses for THESE symbols
    const missing: string[] = [];
    const invalid: string[] = [];

    for (const sym of activeSymbols) {
        const docId = `${TARGET_DATE}_${sym}`;
        const doc = await db.collection('officialCloses').doc(docId).get();

        if (!doc.exists) {
            missing.push(sym);
            console.log(`❌ ALARM: Symbol ${sym} is held but NO EOD doc for ${TARGET_DATE}`);
        } else {
            const data = doc.data();
            if (data?.status !== 'ok' || typeof data.close !== 'number') {
                invalid.push(`${sym} (${data?.status ?? 'unknown'})`);
                console.log(`⚠️ WARNING: Symbol ${sym} doc exists but INVALID:`, data);
            }
        }
    }

    if (missing.length === 0 && invalid.length === 0) {
        console.log('\n✅ SIMULATION RESULT: All held symbols have valid EOD data.');
        console.log('If frontend still shows "Pending Update", check:');
        console.log('1. Browser Cache (Hard Refresh)');
        console.log('2. Date string mismatch (Frontend uses NY Time, we used UTC iso above?)');
    } else {
        console.log('\n❌ SIMULATION RESULT: DATA GAPS FOUND!');
        if (missing.length > 0) console.log(`MISSING DOCS for: ${missing.join(', ')}`);
        if (invalid.length > 0) console.log(`INVALID DOCS for: ${invalid.join(', ')}`);
        console.log('>>> THESE are causing the "Pending Update" on the calendar!');
    }
}

diagnosePnLGap();
