
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Helper: Generate date range
function getDaysArray(start: Date, end: Date) {
    const arr = [];
    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
        arr.push(new Date(dt).toISOString().slice(0, 10));
    }
    return arr;
}

// Simple NY trading day check (exclude weekends for now, holidays optimization later)
function isTradingDay(dateStr: string) {
    const d = new Date(dateStr);
    const day = d.getUTCDay();
    return day !== 0 && day !== 6;
}

async function run() {
    console.log("=== FULL HISTORY EOD GAP FILLER (CollectionGroup) ===");

    // 1. Load All Transactions via User Iteration (using listDocuments for phantoms)
    console.log("Loading all transactions via listDocuments...");
    const userRefs = await db.collection('users').listDocuments();
    console.log(`Found ${userRefs.length} user references.`);

    let allTx: any[] = [];

    for (const userRef of userRefs) {
        // console.log(`Scanning user ${userRef.id}...`);
        const txSnap = await userRef.collection('transactions').get();
        txSnap.forEach(t => {
            const d = t.data();
            const sym = (d.symbol || '').toUpperCase().replace(/\s+/g, '');
            if (d.transactionTimestamp || d.date) {
                // Prefer transactionTimestamp for sorting, but date string for Logic
                let dateStr = d.date;
                if (!dateStr && d.transactionTimestamp) {
                    dateStr = new Date(d.transactionTimestamp).toISOString().slice(0, 10);
                }

                if (dateStr) {
                    allTx.push({
                        date: dateStr,
                        symbol: sym,
                        qty: Number(d.qty || 0),
                        price: Number(d.price || 0)
                    });
                }
            }
        });
    }

    if (allTx.length === 0) {
        console.log("No transactions found.");
        return;
    }

    // Sort tx
    allTx.sort((a, b) => a.date.localeCompare(b.date));
    const minDate = allTx[0].date;
    const maxDate = new Date().toISOString().slice(0, 10); // Today

    console.log(`History Range: ${minDate} to ${maxDate}`);
    console.log(`Transactions Found: ${allTx.length}`);

    // 2. Build Lifecycle Map: Symbol -> { start, end }
    const symbolLifecycles: Record<string, { start: string, end: string }> = {};

    allTx.forEach(tx => {
        if (!tx.symbol) return;
        if (!symbolLifecycles[tx.symbol]) {
            symbolLifecycles[tx.symbol] = { start: tx.date, end: tx.date };
        } else {
            if (tx.date < symbolLifecycles[tx.symbol].start) symbolLifecycles[tx.symbol].start = tx.date;
            if (tx.date > symbolLifecycles[tx.symbol].end) symbolLifecycles[tx.symbol].end = tx.date;
        }
    });

    // 3. Scan and Fill
    const allDays = getDaysArray(new Date(minDate), new Date(maxDate));
    const updates: any[] = [];
    let processedSyms = 0;

    for (const [symbol, range] of Object.entries(symbolLifecycles)) {
        if (symbol === 'UNKNOWN' || !symbol) continue;
        processedSyms++;

        // Fetch Existing Closes
        const eodSnap = await db.collection('officialCloses')
            .where('symbol', '==', symbol)
            .where('date', '>=', range.start)
            // We want to verify up to Today, even if trade ended earlier, 
            // because lifecycle logic above is just trade range. 
            // Ideally we need Holdings check for "Active".
            // But User asked to check "Since first record".
            // Safest: Check Start -> Today.
            .orderBy('date')
            .get();

        const existingDates = new Set<string>();
        const priceMap: Record<string, number> = {};

        eodSnap.forEach(d => {
            const data = d.data();
            existingDates.add(data.date);
            if (data.status === 'ok' && data.close) {
                priceMap[data.date] = data.close;
            }
        });

        // Initialize state
        let lastKnownPrice = 0;

        // Loop days
        for (const dateStr of allDays) {
            if (dateStr < range.start) continue;
            if (!isTradingDay(dateStr)) continue;

            // Update last known
            if (priceMap[dateStr]) {
                lastKnownPrice = priceMap[dateStr];
                continue;
            }

            // Detect MISSING
            if (!existingDates.has(dateStr)) {
                // Determine Fill Price
                let fillPrice = 0;

                // 1. Tx Today?
                const txToday = allTx.filter(t => t.symbol === symbol && t.date === dateStr);
                if (txToday.length > 0) {
                    const validPrices = txToday.map((t: any) => t.price).filter((p: number) => p > 0);
                    if (validPrices.length > 0) {
                        fillPrice = validPrices.reduce((a: number, b: number) => a + b, 0) / validPrices.length;
                    }
                }

                // 2. Forward Fill
                if (fillPrice === 0 && lastKnownPrice > 0) {
                    fillPrice = lastKnownPrice;
                }

                // Apply Fill
                if (fillPrice > 0) {
                    // console.log(`[Queue] ${symbol} ${dateStr} filling ${fillPrice}`);
                    updates.push({
                        docId: `${dateStr}_${symbol}`,
                        data: {
                            status: 'ok',
                            close: fillPrice,
                            symbol: symbol,
                            date: dateStr,
                            tradingDate: dateStr,
                            provider: 'audit_auto_fill',
                            note: 'Full History Auto-Fill',
                            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                        }
                    });
                    // Update State for next day
                    lastKnownPrice = fillPrice;
                    priceMap[dateStr] = fillPrice;
                }
            }
        }
    }

    console.log(`Processed ${processedSyms} symbols.`);
    console.log(`Total gaps to fill: ${updates.length}`);

    // Batch Commit
    const batchSize = 400;
    for (let i = 0; i < updates.length; i += batchSize) {
        const chunk = updates.slice(i, i + batchSize);
        const batch = db.batch();
        chunk.forEach(u => {
            const ref = db.collection('officialCloses').doc(u.docId);
            batch.set(ref, u.data, { merge: true });
        });
        await batch.commit();
        console.log(`Committed batch ${Math.ceil((i + 1) / batchSize)} / ${Math.ceil(updates.length / batchSize)}`);
    }

    console.log("=== DONE ===");
}

run();
