
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Helper to normalize
const normalize = (s: string) => (s || '').toUpperCase().replace(/\s+/g, '');

async function run() {
    console.log("=== GLOBAL HISTORY AUDIT (DOC SCAN METHOD) ===");
    console.log("-> Listing Users...");

    // 1. Get All Transactions
    const userRefs = await db.collection('users').listDocuments();
    let allTx: { date: string, symbol: string, price: number }[] = [];

    for (const ref of userRefs) {
        // Checking transactions
        const txSnap = await ref.collection('transactions').get();
        txSnap.forEach(d => processDoc(d.data()));
        // Checking trades
        const trSnap = await ref.collection('trades').get();
        trSnap.forEach(d => processDoc(d.data()));
    }

    function processDoc(d: any) {
        const sym = normalize(d.symbol);
        let dateStr = d.date;
        if (!dateStr && d.transactionTimestamp) dateStr = new Date(d.transactionTimestamp).toISOString().slice(0, 10);
        const p = Number(d.price || d.avgPrice || 0);

        if (sym && dateStr) {
            allTx.push({ date: dateStr, symbol: sym, price: p });
        }
    }

    if (allTx.length === 0) {
        console.log("No transactions found.");
        return;
    }

    // 2. Lifecycles
    allTx.sort((a, b) => a.date.localeCompare(b.date));
    const lifecycles: Record<string, string> = {};
    allTx.forEach(tx => {
        if (!lifecycles[tx.symbol] || tx.date < lifecycles[tx.symbol]) {
            lifecycles[tx.symbol] = tx.date;
        }
    });

    const symbols = Object.keys(lifecycles);
    console.log(`-> Symbols to Audit: ${symbols.length}`);
    console.log(`-> Start Date: ${allTx[0].date}`);

    // 3. Scan Day-by-Day (Doc Reads)
    const todayStr = new Date().toISOString().slice(0, 10);
    const batchWriter = db.batch();
    let batchCount = 0;
    let gapsFilled = 0;

    for (const sym of symbols) {
        const start = lifecycles[sym];
        let d = new Date(start);
        const end = new Date(todayStr);

        let lastPrice = 0;
        // Seed
        const seed = allTx.find(t => t.symbol === sym && t.date === start && t.price > 0);
        if (seed) lastPrice = seed.price;

        console.log(`\nScanning ${sym} (${start} -> Now)...`);
        process.stdout.write("   ");

        while (d <= end) {
            const dateStr = d.toISOString().slice(0, 10);
            const day = d.getUTCDay();

            if (day !== 0 && day !== 6) {
                // Check Doc
                const docId = `${dateStr}_${sym}`;

                // Do we have a cached read? No, direct DB read.
                let exists = false;
                let price = 0;

                try {
                    const snap = await db.collection('officialCloses').doc(docId).get();
                    if (snap.exists) {
                        const data = snap.data();
                        if (data && data.close > 0) {
                            exists = true;
                            price = data.close;
                        }
                    }
                } catch (e) { /* ignore read error */ }

                if (exists) {
                    lastPrice = price; // Update chain
                    process.stdout.write("o");
                } else {
                    // GAP
                    // Check TX today
                    const txs = allTx.filter(t => t.symbol === sym && t.date === dateStr && t.price > 0);
                    let fill = 0;
                    if (txs.length > 0) {
                        fill = txs.reduce((a, b) => a + b.price, 0) / txs.length;
                    }

                    // Forward Fill
                    if (fill === 0 && lastPrice > 0) fill = lastPrice;

                    if (fill > 0) {
                        process.stdout.write("X"); // Mark fix
                        batchWriter.set(db.collection('officialCloses').doc(docId), {
                            symbol: sym, date: dateStr, tradingDate: dateStr, close: fill,
                            status: 'ok', provider: 'audit_doc_scan', note: 'Deep Audit',
                            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        batchCount++;
                        gapsFilled++;
                        lastPrice = fill;
                    } else {
                        process.stdout.write("?"); // Unfixable
                    }
                }
            }
            d.setDate(d.getDate() + 1);
        }
    }

    if (batchCount > 0) {
        console.log(`\n\n-> Committing ${batchCount} fixes...`);
        await batchWriter.commit();
        console.log("-> Success.");
    } else {
        console.log("\n\n-> No gaps found.");
    }
}

run().catch(e => console.error(e));
