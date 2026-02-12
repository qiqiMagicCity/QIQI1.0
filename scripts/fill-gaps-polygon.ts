
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { eachDayOfInterval, format, isSaturday, isSunday, isFuture } from 'date-fns';

// Service Account setup
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

// --- CONFIG ---
const OPTION_START_DATE = '2024-02-01'; // Polygon Option History Limit
const STOCK_START_YEAR = 2023; // Look back to Jan 1 2023 for safety (or align with data)

// --- HELPERS ---

const isStock = (s: string) => /^[A-Z]+$/.test(s) && s.length < 10;
const normalize = (s: string) => s.trim().toUpperCase();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const nyHolidays = new Set([
    '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07', '2023-05-29', '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
    '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
    '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
    '2026-01-01'
]);
// Helper for trading day check
function isTradingDay(dateStr: string): boolean {
    const d = new Date(dateStr);
    if (isSaturday(d) || isSunday(d)) return false;
    if (nyHolidays.has(dateStr)) return false;
    if (isFuture(d)) return false;
    return true;
}

// FETCH POLYGON
async function fetchPolygonEod(symbol: string, date: string): Promise<number | null> {
    try {
        const url = `https://api.polygon.io/v1/open-close/${symbol}/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404 || res.status === 403) return null;
            // console.warn(`[Polygon Gap] Error ${res.status} for ${symbol} on ${date}`);
            return null;
        }

        const data: any = await res.json();
        return typeof data.close === 'number' ? data.close : null;
    } catch (e: any) {
        return null; // Silent catch for speed
    }
}

// MAIN LOGIC
async function main() {
    console.log("🚀 STARTING GAP FILLER (POLYGON MASSIVE) 🚀");
    console.log("------------------------------------------");

    // 1. Gather all unique required Date+Symbol combinations from Transactions
    console.log("SCANNING TRANSACTIONS...");

    const userRefs = await db.collection('users').listDocuments();
    const activeSymbols = new Set<string>();
    const symbolMinDate = new Map<string, string>(); // Earliest activity per symbol

    for (const userRef of userRefs) {
        const txSnap = await userRef.collection('transactions').get();
        txSnap.forEach(doc => {
            const d = doc.data();
            const sym = normalize(d.symbol);
            if (!sym) return;

            activeSymbols.add(sym);

            // Track min date from tx if available, else default to 2023-01-01
            // Convert timestamp to date string
            let txDateStr = '2023-01-01';
            if (d.date) txDateStr = d.date; // if available
            else if (d.transactionDate) txDateStr = new Date(d.transactionDate).toISOString().split('T')[0];

            // Update min date
            const currentMin = symbolMinDate.get(sym) || '2099-12-31';
            if (txDateStr < currentMin) symbolMinDate.set(sym, txDateStr);
        });
    }

    console.log(`Found ${activeSymbols.size} symbols. Determining gaps...`);
    const symbols = Array.from(activeSymbols);
    symbols.sort();

    const today = new Date(); // Stop at today
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const endStr = format(yesterday, 'yyyy-MM-dd');

    let totalFilled = 0;

    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const isOpt = !isStock(symbol);

        // Determine start date
        // For Options: Strict start at OPTION_START_DATE (Feb 1 2024)
        // For Stocks: Start at min transaction date OR Jan 1 2023
        let validStart = symbolMinDate.get(symbol) || '2023-01-01';
        if (validStart < '2023-01-01') validStart = '2023-01-01'; // Cap at 2023

        if (isOpt) {
            if (validStart < OPTION_START_DATE) validStart = OPTION_START_DATE;
        }

        // Generate target dates
        if (validStart > endStr) continue; // Nothing to fill

        const interval = eachDayOfInterval({
            start: new Date(validStart),
            end: new Date(endStr)
        });

        const targetDates = interval
            .map(d => format(d, 'yyyy-MM-dd'))
            .filter(d => isTradingDay(d)); // Filter weekends/holidays

        if (targetDates.length === 0) continue;

        // Fetch existing records for this symbol to check what we already have
        // (We assume 'fix-eod-polygon.ts' has already scrubbed dirty ones, so existing ones are 'ok')
        // We only care about MISSING ones.

        // BATCH GET IDS? (Can be large)
        // Better: Query Firestore by symbol again.
        const closesSnap = await db.collection('officialCloses')
            .where('symbol', '==', symbol)
            .where('date', '>=', validStart)
            .get();

        const existingDateSet = new Set<string>();
        closesSnap.forEach(d => {
            const data = d.data();
            // trust existing.
            const date = data.tradingDate || d.id.split('_')[0];
            existingDateSet.add(date);
        });

        // Identify Gaps
        const missingDates = targetDates.filter(d => !existingDateSet.has(d));

        if (missingDates.length === 0) {
            // console.log(`[${i+1}/${symbols.length}] ${symbol}: Clean.`);
            continue;
        }

        console.log(`[${i + 1}/${symbols.length}] ${symbol}: Found ${missingDates.length} gaps. Filling...`);

        // FILL GAPS
        let filledForSym = 0;
        const batchSize = 400;
        let batch = db.batch();
        let ops = 0;

        // Process in chunks (sequential fetch to be safe)
        for (const mDate of missingDates) {
            const price = await fetchPolygonEod(symbol, mDate);
            if (price !== null) {
                const ref = db.collection('officialCloses').doc(`${mDate}_${symbol}`);
                batch.set(ref, {
                    symbol: symbol,
                    date: mDate,
                    tradingDate: mDate,
                    close: price,
                    status: 'ok',
                    provider: 'polygon_gap_fill',
                    retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                ops++;
                filledForSym++;
                totalFilled++;
            } else {
                // Determine if we should mark as 'missing' strictly to avoid refetch?
                // Or leave blank. Leaving blank allows retry later.
                // For now, leave blank.
                // console.log(`   Failed gap: ${mDate}`);
            }

            if (ops >= batchSize) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }

            await sleep(10); // Throttle lightly
        }

        if (ops > 0) {
            await batch.commit();
        }

        if (filledForSym > 0) {
            console.log(`   ✅ Filled ${filledForSym} gaps for ${symbol}.`);
        }
    }

    console.log("\n------------------------------------------");
    console.log(`🏁 GAP FILL SUMMARY`);
    console.log(`Total Days Filled: ${totalFilled}`);
    console.log("------------------------------------------");
}

main().catch(console.error);
