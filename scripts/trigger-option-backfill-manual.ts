
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
// import yahooFinance from 'yahoo-finance2'; // Use require inside main to avoid ESM/TS issues

// 1. Initialize Firebase
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        console.error("Firebase init failed", e);
        process.exit(1);
    }
}

const db = getFirestore();

// Helper: Normalize Yahoo date to YYYY-MM-DD
function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function main() {
    console.log("=== Quick Fix: Auto-Backfill Options EOD via Yahoo (Local Script) ===");
    console.log("Target Date: 2026-02-03 (Assuming 'Yesterday' relative to user's 2026-02-04 context)");

    // 2. Scan for Options in Holdings
    console.log("Scanning users for 'option' holdings...");
    const usersSnap = await db.collection('users').get();
    const symbols = new Set<string>();

    for (const userDoc of usersSnap.docs) {
        const holdingsVal = userDoc.data().holdings;
        // Holdings might be a subcollection or field. 
        // Based on use-holdings.ts, it seems to come from `users/{uid}/holdings` subcollection in typical generic setup, 
        // OR a `holdings` field. 
        // Let's check subcollection.

        const holdingsSnap = await userDoc.ref.collection('holdings').get();
        if (!holdingsSnap.empty) {
            holdingsSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.assetType === 'option' || (data.symbol && data.symbol.length > 10 && /\d/.test(data.symbol))) {
                    symbols.add(data.symbol);
                }
            });
        }
    }

    // Manual add from screenshot (Short Symbols)
    const manualSymbols = [
        'GOOGL260918C150',
        'INTC240308P40.5'
    ];
    // manualSymbols.forEach(s => symbols.add(s));
    // Clear auto-scan and just force manual list
    symbols.clear();
    manualSymbols.forEach(s => symbols.add(s));

    const targetSymbols = Array.from(symbols);
    console.log(`Found ${targetSymbols.length} option symbols:`, targetSymbols);

    if (targetSymbols.length === 0) {
        console.log("No options found. Exiting.");
        return;
    }

    // 3. Fetch from Yahoo
    // UPDATED: User scenario is 2026-02-05, so we need 2026-02-04 logic
    const targetDate = '2026-02-04';

    // Yahoo Config - Robust Init
    let yf: any;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('yahoo-finance2');
        if (typeof pkg.default === 'function') {
            yf = new pkg.default();
        } else if (typeof pkg === 'function') {
            yf = new pkg();
        } else {
            yf = pkg.default || pkg;
        }
    } catch (e) {
        console.error("Failed to load yahoo-finance2", e);
        return;
    }

    for (const symbol of targetSymbols) {
        // Auto-detect Short Option Symbol and convert to OCC for Yahoo API call
        // We use fetchSymbol for Yahoo, but 'symbol' (Short) for Firestore key
        let fetchSymbol = symbol;
        const optionMatch = symbol.match(/^([A-Z]+)(\d{6})([CP])([\d.]+)$/);
        if (optionMatch) {
            const [, ticker, date, type, priceStr] = optionMatch;
            if (priceStr.length !== 8 || priceStr.includes('.')) {
                const priceNum = parseFloat(priceStr);
                if (!isNaN(priceNum)) {
                    const scaled = Math.round(priceNum * 1000);
                    const padded = String(scaled).padStart(8, '0');
                    fetchSymbol = `${ticker}${date}${type}${padded}`;
                    console.log(`[Script] Converted Short ${symbol} -> OCC ${fetchSymbol}`);
                }
            }
        }

        process.stdout.write(`Processing ${symbol} (using ${fetchSymbol})... `);
        try {
            // Fetch historical for a range around target date
            const queryOptions = {
                period1: '2026-02-01',
                period2: '2026-02-05',
            };
            const result = await yf.historical(fetchSymbol, queryOptions);

            // Find 2026-02-03
            const match = result.find((r: any) => formatDate(r.date) === targetDate);

            if (match && match.close) {
                // 4. Save to Official Closes
                // IMPORTANT: Save using the ORIGINAL (Short) symbol as ID
                const docId = `${targetDate}_${symbol}`;
                await db.collection('officialCloses').doc(docId).set({
                    symbol: symbol, // Short Symbol
                    date: targetDate,
                    tradingDate: targetDate,
                    close: match.close,
                    currency: 'USD',
                    provider: 'yahoo_script_backfill',
                    source: 'official',
                    status: 'ok',
                    tz: 'America/New_York',
                    retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                console.log(`✅ Saved $${match.close}`);
            } else {
                console.log(`⚠️ No data for ${targetDate} (Yahoo returned ${result.length} rows)`);
                if (result.length > 0) {
                    console.log(`   Available: ${result.map((r: any) => formatDate(r.date)).join(', ')}`);
                }
            }

        } catch (e: any) {
            console.log(`❌ Error: ${e.message}`);
        }
    }

    console.log("=== Done ===");
}

main();
