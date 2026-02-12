
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Helper to normalize
const normalize = (s: string) => (s || '').toUpperCase().replace(/\s+/g, '');

async function run() {
    console.log("=== GLOBAL HISTORY AUDIT (DEBUG MODE) ===");

    // 1. Get Users
    console.log("-> Listing Users...");
    const userRefs = await db.collection('users').listDocuments();
    console.log(`-> Found ${userRefs.length} users.`);

    let allTx: { date: string, symbol: string, price: number }[] = [];

    // 2. Scan each user
    for (const ref of userRefs) {
        console.log(`   Scanning User: ${ref.id}`);

        // Check 'transactions'
        const txSnap = await ref.collection('transactions').get();
        console.log(`     - transactions: ${txSnap.size} docs`);

        // Check 'trades'
        const trSnap = await ref.collection('trades').get();
        console.log(`     - trades:       ${trSnap.size} docs`);

        // Helper to process docs
        const processDoc = (d: any) => {
            const rawSym = d.symbol || '';
            const sym = normalize(rawSym);

            // Determine date
            let dateStr = d.date; // manual trades often have 'date'
            if (!dateStr && d.transactionTimestamp) {
                dateStr = new Date(d.transactionTimestamp).toISOString().slice(0, 10);
            }

            // If still no date, skip
            if (!dateStr) return;

            // Price fallback
            // Some manual trades might have 'price' or 'avgPrice'
            const p = Number(d.price || d.avgPrice || 0);

            if (sym && dateStr) {
                allTx.push({ date: dateStr, symbol: sym, price: p });
            }
        };

        txSnap.forEach(doc => processDoc(doc.data()));
        trSnap.forEach(doc => processDoc(doc.data()));
    }

    if (allTx.length === 0) {
        console.log("!!! NO TRANSACTIONS FOUND IN ANY COLLECTION !!!");
        // Try CollectionGroup fallback just to be insane
        console.log("-> Trying CollectionGroup 'trades'...");
        const cgSnap = await db.collectionGroup('trades').get();
        console.log(`   Found ${cgSnap.size} docs via CG.`);
        return;
    }

    // 3. Flatten and Min/Max
    allTx.sort((a, b) => a.date.localeCompare(b.date));
    const minDate = allTx[0].date;
    const maxDate = new Date().toISOString().slice(0, 10);
    console.log(`-> Total Valid Records: ${allTx.length}`);
    console.log(`-> Range: ${minDate} to ${maxDate}`);

    // 4. Analysis
    const lifecycles: Record<string, string> = {}; // Sym -> StartDate
    allTx.forEach(tx => {
        if (!lifecycles[tx.symbol] || tx.date < lifecycles[tx.symbol]) {
            lifecycles[tx.symbol] = tx.date;
        }
    });

    const symbols = Object.keys(lifecycles);
    console.log(`-> Found ${symbols.length} unique symbols.`);

    // 5. Repair Loop
    let updates = 0;
    const batchWriter = db.batch();
    let batchCount = 0;

    for (const sym of symbols) {
        const startDate = lifecycles[sym];
        // console.log(`   Checking ${sym} from ${startDate}...`);

        // Scan EODs
        const closesSnap = await db.collection('officialCloses')
            .where('symbol', '==', sym)
            .where('date', '>=', startDate)
            .orderBy('date')
            .get();

        const knownDates = new Set<string>();
        const priceMap: Record<string, number> = {};

        closesSnap.forEach(d => {
            const data = d.data();
            if (data.status === 'ok' && data.close) {
                knownDates.add(data.date);
                priceMap[data.date] = data.close;
            }
        });

        // Iterate days
        let d = new Date(startDate);
        const end = new Date(maxDate);
        let lastPrice = 0;

        // Try seed
        const seedTx = allTx.find(t => t.symbol === sym && t.date === startDate && t.price > 0);
        if (seedTx) lastPrice = seedTx.price;

        while (d <= end) {
            const dateStr = d.toISOString().slice(0, 10);
            const day = d.getUTCDay();
            if (day !== 0 && day !== 6) { // Weekdays only
                if (knownDates.has(dateStr)) {
                    lastPrice = priceMap[dateStr];
                } else {
                    // GAP
                    // 1. Check TX price today
                    const dayTxs = allTx.filter(t => t.symbol === sym && t.date === dateStr && t.price > 0);
                    let fillPrice = 0;
                    if (dayTxs.length > 0) {
                        fillPrice = dayTxs.reduce((a, b) => a + b.price, 0) / dayTxs.length;
                    }

                    // 2. Forward Fill
                    if (fillPrice === 0 && lastPrice > 0) fillPrice = lastPrice;

                    // 3. Commit
                    if (fillPrice > 0) {
                        const ref = db.collection('officialCloses').doc(`${dateStr}_${sym}`);
                        batchWriter.set(ref, {
                            symbol: sym,
                            date: dateStr,
                            tradingDate: dateStr,
                            close: fillPrice,
                            status: 'ok',
                            provider: 'audit_auto_fill',
                            note: 'Global Audit Repair',
                            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });

                        updates++;
                        batchCount++;
                        lastPrice = fillPrice; // Update state
                        knownDates.add(dateStr); // Mark filled
                    }
                }
            }
            d.setDate(d.getDate() + 1);
        }
    }

    if (batchCount > 0) {
        console.log(`-> Committing ${batchCount} fixes...`);
        await batchWriter.commit();
    }
    console.log("=== DONE ===");
}

run().catch(e => console.error(e));
