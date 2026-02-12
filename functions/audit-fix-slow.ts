
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    console.log("=== SLOW & STEADY AUDIT ===");

    // Target specific user found in previous logs
    const uid = 'KzHBjCK4nMhMb6KXrbZSfrDI0CC2';
    console.log(`Targeting User: ${uid}`);

    const txRef = db.collection('users').doc(uid).collection('transactions');
    const snap = await txRef.get();

    if (snap.empty) {
        console.log("No transactions.");
        return;
    }

    const allTx: any[] = [];
    snap.forEach(d => {
        const data = d.data();
        const sym = (data.symbol || '').toUpperCase().replace(/\s+/g, '');
        const date = data.date || (data.transactionTimestamp ? new Date(data.transactionTimestamp).toISOString().slice(0, 10) : null);

        // Handle "NIO260618P3.5" vs "NIO260618P00003500"
        // If the user's symbol is P3.5, we trust it. 
        // Our system likely queries by that same string.

        if (sym && date) {
            allTx.push({
                symbol: sym,
                date: date,
                price: Number(data.price || 0)
            });
        }
    });

    // Sort
    allTx.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`Loaded ${allTx.length} transactions.`);
    console.log(`Range: ${allTx[0].date} -> ${new Date().toISOString().slice(0, 10)}`);

    // Group by Symbol
    const symbols: Record<string, string> = {};
    allTx.forEach(t => {
        if (!symbols[t.symbol] || t.date < symbols[t.symbol]) {
            symbols[t.symbol] = t.date;
        }
    });

    const uniqueSyms = Object.keys(symbols);
    console.log(`Found ${uniqueSyms.length} unique symbols: ${uniqueSyms.join(', ')}`);

    let totalFixed = 0;
    const batchWriter = db.batch();
    let batchCount = 0;

    for (const sym of uniqueSyms) {
        const start = symbols[sym];
        console.log(`\nChecking ${sym} from ${start}...`);

        await sleep(200); // Be nice

        // Fetch existing
        const history = await db.collection('officialCloses')
            .where('symbol', '==', sym)
            .where('date', '>=', start)
            .orderBy('date')
            .get();

        const map: Record<string, number> = {};
        history.forEach(h => {
            const d = h.data();
            if (d.status === 'ok') map[d.date] = d.close;
        });

        // Fill
        let d = new Date(start);
        const today = new Date();
        let lastPrice = 0;

        // Seed
        const seed = allTx.find(t => t.symbol === sym && t.date === start);
        if (seed) lastPrice = seed.price;

        while (d <= today) {
            const dateStr = d.toISOString().slice(0, 10);
            const day = d.getUTCDay();

            if (day !== 0 && day !== 6) {
                if (map[dateStr]) {
                    lastPrice = map[dateStr];
                } else {
                    // Missing. Try to fill.
                    let fill = 0;

                    // 1. Tx Today?
                    const todays = allTx.filter(t => t.symbol === sym && t.date === dateStr);
                    if (todays.length > 0) {
                        const sum = todays.reduce((a, b) => a + b.price, 0);
                        if (sum > 0) fill = sum / todays.length;
                    }

                    // 2. Forward Fill
                    if (fill === 0 && lastPrice > 0) fill = lastPrice;

                    if (fill > 0) {
                        console.log(`  -> Fixing ${dateStr} @ ${fill}`);
                        const ref = db.collection('officialCloses').doc(`${dateStr}_${sym}`);
                        batchWriter.set(ref, {
                            date: dateStr,
                            symbol: sym,
                            close: fill,
                            status: 'ok',
                            provider: 'audit_slow_repair',
                            note: 'Full History Repair',
                            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });

                        batchCount++;
                        totalFixed++;
                        lastPrice = fill;
                        map[dateStr] = fill; // Update cache
                    }
                }
            }
            d.setDate(d.getDate() + 1);
        }
    }

    if (batchCount > 0) {
        console.log(`\nCommitting ${batchCount} fixes...`);
        await batchWriter.commit();
    }
    console.log("=== DONE ===");
}

run().catch(e => console.error(e));
