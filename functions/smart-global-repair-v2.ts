
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// --- Helpers ---
const normalize = (s: string) => (s || '').toUpperCase().replace(/\s+/g, '');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Generate array of YYYY-MM-DD
function getDates(start: string, end: string) {
    const arr = [];
    let d = new Date(start);
    const e = new Date(end);
    while (d <= e) {
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) {
            arr.push(d.toISOString().slice(0, 10));
        }
        d.setDate(d.getDate() + 1);
    }
    return arr;
}

// Global Cache for Transactions
let globalTxMap: Record<string, Record<string, number>> = {}; // Sym -> Date -> AvgPrice

async function loadAllTransactions() {
    console.log("-> Loading Transaction Skeleton...");
    const userRefs = await db.collection('users').listDocuments();
    let count = 0;

    for (const ref of userRefs) {
        const txSnap = await ref.collection('transactions').get();
        const trSnap = await ref.collection('trades').get();

        const process = (doc: any) => {
            const d = doc.data();
            const sym = normalize(d.symbol);
            if (!sym) return;

            let date = d.date;
            if (!date && d.transactionTimestamp) date = new Date(d.transactionTimestamp).toISOString().slice(0, 10);
            if (!date) return;

            const p = Number(d.price || d.avgPrice || 0);
            if (p < 0) return;

            if (!globalTxMap[sym]) globalTxMap[sym] = {};

            // Average if multiple
            if (globalTxMap[sym][date]) {
                if (p > 0) globalTxMap[sym][date] = (globalTxMap[sym][date] + p) / 2;
            } else {
                if (p > 0) globalTxMap[sym][date] = p;
                else globalTxMap[sym][date] = 0;
            }
            count++;
        };

        txSnap.forEach(process);
        trSnap.forEach(process);
    }
    console.log(`-> Loaded ${count} transactions across ${Object.keys(globalTxMap).length} symbols.`);
    return Object.keys(globalTxMap);
}

// Process a Single Symbol
async function repairSymbol(sym: string, minDate: string, maxDate: string) {
    const allDays = getDates(minDate, maxDate);
    // [MODIFIED] Store full metadata for strict auditing
    const dbMap: Record<string, { close: number, provider?: string, note?: string }> = {};

    // Batch load DB Data
    const BATCH_READ_SIZE = 50;
    for (let i = 0; i < allDays.length; i += BATCH_READ_SIZE) {
        const batchDates = allDays.slice(i, i + BATCH_READ_SIZE);
        const refs = batchDates.map(d => db.collection('officialCloses').doc(`${d}_${sym}`));

        try {
            const snaps = await db.getAll(...refs);
            snaps.forEach(snap => {
                if (snap.exists) {
                    const snapData = snap.data();
                    if (snapData && (snapData.status === 'ok' || snapData.close > 0)) {
                        dbMap[snapData.date] = {
                            close: snapData.close,
                            provider: snapData.provider,
                            note: snapData.note
                        };
                    }
                }
            });
        } catch (e) {
            console.warn(`Error fetching batch for ${sym}:`, e);
        }
    }

    // 2. Fetch External Data (If Stock) - Re-enabled
    const stockDataMap: Record<string, number> = {};
    const isStock = (s: string) => /^[A-Z]+$/.test(s) && s.length < 10;

    if (isStock(sym)) {
        try {
            const result = await require('yahoo-finance2').default.historical(sym, {
                period1: minDate,
                period2: maxDate
            });
            result.forEach((r: any) => {
                const dStr = r.date.toISOString().slice(0, 10);
                if (r.close) stockDataMap[dStr] = r.close;
            });
        } catch (e) {
            // console.warn(`Yahoo fetch failed for ${sym}`, e);
        }
    }

    // Walk and Fill
    const updates: any[] = [];
    let lastPrice = 0;

    // Seed from first Tx if visible
    if (globalTxMap[sym] && globalTxMap[sym][minDate]) lastPrice = globalTxMap[sym][minDate];

    for (const date of allDays) {
        const dbEntry = dbMap[date];
        let price = 0;
        let source = '';

        // [CRITICAL] Detect Tainted Data for Stocks
        // If it's a Stock, and the DB record says it was repaired via 'tx' or 'forward_fill', it is INVALID.
        let isTaintedDb = false;
        if (isStock(sym) && dbEntry) {
            const n = (dbEntry.note || '').toLowerCase();
            const p = (dbEntry.provider || '').toLowerCase();
            // Check for signatures of previous repair scripts
            if (p.includes('repair') || p.includes('gap_fill')) {
                if (n.includes('tx') || n.includes('forward_fill')) {
                    isTaintedDb = true;
                }
            }
        }

        // Priority 1: Valid DB Data
        if (dbEntry && !isTaintedDb) {
            price = dbEntry.close;
            source = 'db';
        }
        // Priority 2: External Real Data (Yahoo)
        else if (stockDataMap[date]) {
            price = stockDataMap[date];
            source = 'yahoo';
        }
        // Priority 3: Transaction on this day (STRICT: OPTIONS ONLY)
        else if (globalTxMap[sym] && globalTxMap[sym][date] > 0 && !isStock(sym)) {
            price = globalTxMap[sym][date];
            source = 'tx';
        }
        // Priority 4: Forward Fill (STRICT: OPTIONS ONLY)
        else if (lastPrice > 0 && !isStock(sym)) {
            price = lastPrice;
            source = 'forward_fill';
        }

        if (price > 0) {
            lastPrice = price; // Carry forward context

            // Action: Write if missing OR if we are overwriting Tainted DB
            if (!dbEntry || isTaintedDb) {
                updates.push({
                    type: 'set',
                    docId: `${date}_${sym}`,
                    data: {
                        symbol: sym,
                        date: date,
                        tradingDate: date,
                        close: price,
                        status: 'ok',
                        provider: source === 'yahoo' ? 'yahoo' : 'smart_repair_strict',
                        note: `Repaired via ${source}`,
                        retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                });
            }
        } else {
            // Price is MISSING.
            // If we have a Tainted DB record here, we MUST DELETE IT to enforce "Null" result.
            if (isTaintedDb) {
                updates.push({
                    type: 'delete',
                    docId: `${date}_${sym}`
                });
            }
        }
    }

    return updates;
}

async function run() {
    console.log("=== SMART GLOBAL REPAIR V2 (STRICT PURGE MODE) ===");

    // 1. Load Scope
    const symbols = await loadAllTransactions();
    const today = new Date().toISOString().slice(0, 10);
    const batchWriter = db.batch();
    let batchCount = 0;
    let totalFixes = 0;

    // 2. Process in Chunks for Concurrency
    const CHUNK_SIZE = 10;
    const totalBatches = Math.ceil(symbols.length / CHUNK_SIZE);

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + CHUNK_SIZE);
        const batchIndex = Math.floor(i / CHUNK_SIZE) + 1;
        console.log(`Processing batch ${batchIndex}/${totalBatches}...`);

        const results: any[] = [];
        for (const sym of chunk) {
            // Determine lifecycle
            const dates = Object.keys(globalTxMap[sym] || {}).sort();
            const start = dates[0] || '2024-01-01';
            results.push(await repairSymbol(sym, start, today));
        }
        const allUpdates = results.flat();

        // Batch
        for (const up of allUpdates) {
            const ref = db.collection('officialCloses').doc(up.docId);
            if (up.type === 'delete') {
                batchWriter.delete(ref);
            } else {
                batchWriter.set(ref, up.data, { merge: true });
            }
            batchCount++;
            totalFixes++;

            if (batchCount >= 400) {
                await batchWriter.commit();
                console.log(`   Committing ${batchCount} updates...`);
                batchCount = 0;
            }
        }

        // await sleep(200);
    }

    if (batchCount > 0) {
        console.log(`   Committing final ${batchCount} updates...`);
        await batchWriter.commit();
    }

    console.log(`=== DONE. Fixed/Purged ${totalFixes} data points. ===`);
}

run().catch(e => console.error(e));
