
import * as admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';

// Service Account setup (Auto-detect or use default)
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

// --- CONFIG ---
const OPTION_START_DATE = '2024-02-01'; // Polygon Limit
const DEBUG_MODE = false; // Set true to verify before writing

// --- HELPERS ---

const isStock = (s: string) => /^[A-Z]+$/.test(s) && s.length < 10;
const normalize = (s: string) => s.trim().toUpperCase();

// Sleep helper to avoid API rate spam (though Massive is high limit)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// FETCH POLYGON (v2/aggs)
async function fetchPolygonEod(symbol: string, date: string): Promise<number | null> {
    try {
        // v2/aggs for better consistency across stocks (10y) and options (2y)
        const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&sort=asc&limit=1&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404 || res.status === 403) {
                // Common for holidays or out of range
                return null;
            }
            console.warn(`[Polygon] Error ${res.status} for ${symbol} on ${date}: ${res.statusText}`);
            return null;
        }

        const data: any = await res.json();

        if (data.results && data.results.length > 0) {
            return data.results[0].c; // Close price
        }

        return null; // Empty results means no trading data for this day
    } catch (e: any) {
        console.error(`[Polygon] Exception for ${symbol}:`, e.message);
        return null;
    }
}

// MAIN LOGIC
async function main() {
    console.log("🚀 STARTING EOD DATA REPAIR (POLYGON MASSIVE - v2/aggs) 🚀");
    console.log("------------------------------------------------");

    // 1. Gather all unique required Date+Symbol combinations from Transactions
    console.log("SCANNING TRANSACTIONS...");

    const userRefs = await db.collection('users').listDocuments();
    const activeSymbols = new Set<string>();

    for (const userRef of userRefs) {
        console.log(`Checking user: ${userRef.id}`);
        const txSnap = await userRef.collection('transactions').get();
        txSnap.forEach(doc => {
            const d = doc.data();
            const sym = normalize(d.symbol);
            if (!sym) return;
            activeSymbols.add(sym);
        });
    }

    console.log(`Found ${activeSymbols.size} active symbols.`);
    const symbols = Array.from(activeSymbols);
    symbols.sort();

    let totalFixed = 0;
    let totalPurged = 0;

    // Process each symbol
    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const isOpt = !isStock(symbol);

        // Log progress
        console.log(`\n[${i + 1}/${symbols.length}] Processing ${symbol} (${isOpt ? 'OPTION' : 'STOCK'})...`);

        // QUERY ALL EXISTING RECORDS FOR SYMBOL
        const closesSnap = await db.collection('officialCloses')
            .where('symbol', '==', symbol)
            .get();

        if (closesSnap.empty) {
            console.log(`   No existing data for ${symbol}. Skipping cleanup.`);
            continue;
        }

        console.log(`   Scanning ${closesSnap.size} records...`);

        const dirtyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        const missingContentDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

        closesSnap.forEach(doc => {
            const data = doc.data();
            const provider = data.provider || '';
            const status = data.status || '';

            // Check Dirty
            if (provider === 'via_tx' || provider === 'manual_dirty' || provider.includes('transaction')) {
                dirtyDocs.push(doc);
            }
            // Check 'Error' or 'Missing' status that needs retry
            else if (status !== 'ok') {
                missingContentDocs.push(doc);
            }
        });

        const toRepair = [...dirtyDocs, ...missingContentDocs];
        // Unique dates
        const datesToRepair = Array.from(new Set(toRepair.map(d => {
            const data = d.data();
            return data.tradingDate || data.date || d.id.split('_')[0];
        }))).sort();

        if (datesToRepair.length > 0) {
            console.log(`   Found ${datesToRepair.length} dirty/broken dates to repair.`);

            // BATCH REPAIR
            for (const date of datesToRepair) {
                // OPTION CONSTRAINT
                if (isOpt && date < OPTION_START_DATE) {
                    // Purge but don't repair (Out of subscription range)
                    const ref = db.collection('officialCloses').doc(`${date}_${symbol}`);
                    if (!DEBUG_MODE) await ref.delete();
                    console.log(`   🗑️ Purged (Old Option < Feb 2024): ${date}`);
                    totalPurged++;
                    continue;
                }

                // FETCH
                const price = await fetchPolygonEod(symbol, date);

                if (price !== null) {
                    const ref = db.collection('officialCloses').doc(`${date}_${symbol}`);
                    if (!DEBUG_MODE) {
                        await ref.set({
                            symbol: symbol,
                            date: date,
                            tradingDate: date,
                            close: price,
                            status: 'ok',
                            provider: 'polygon_massive',
                            retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                    console.log(`   ✅ Fixed: ${date} @ $${price}`);
                    totalFixed++;
                } else {
                    console.log(`   ⚠️ Failed to fetch: ${date} (Polygon returned null)`);
                    // If it was dirty, we MUST delete it to avoid showing bad data
                    const wasDirty = dirtyDocs.some(d => d.id === `${date}_${symbol}`);
                    if (wasDirty) {
                        const ref = db.collection('officialCloses').doc(`${date}_${symbol}`);
                        if (!DEBUG_MODE) await ref.delete();
                        console.log(`   🗑️ Purged (No Data): ${date}`);
                        totalPurged++;
                    }
                }

                // Rate limit (Massive is fast, but let's be kind)
                await sleep(20);
            }
        } else {
            console.log(`   All ${closesSnap.size} records clean.`);
        }
    }

    console.log("\n------------------------------------------------");
    console.log(`🏁 REPAIR SUMMARY`);
    console.log(`Total Fixed (Overwritten): ${totalFixed}`);
    console.log(`Total Purged (Deleted):    ${totalPurged}`);
    console.log("------------------------------------------------");
}

main().catch(console.error);
