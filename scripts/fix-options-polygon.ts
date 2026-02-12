
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

function toPolygonTicker(symbol: string): string {
    // Check if Option (Space separated?)
    // Format: "AAPL 260206 C 270" or "AAPL 241108 P 215" (Strike potentially decimal)
    // Regex: ^([A-Z]+)\s+(\d{6})\s+([CP])\s+([\d\.]+)$

    // Normalize spaces
    const s = symbol.trim().toUpperCase().replace(/\s+/g, ' ');
    const match = s.match(/^([A-Z]+)\s(\d{6})\s([CP])\s([\d\.]+)$/);

    if (!match) {
        // Assume it's a Stock or already formatted
        return symbol;
    }

    const [_, root, date, type, strikeStr] = match;
    const strike = parseFloat(strikeStr);
    const strikeInt = Math.round(strike * 1000);
    const strikePart = strikeInt.toString().padStart(8, '0');

    return `O:${root}${date}${type}${strikePart}`;
}

async function fetchPolygonEod(formattedTicker: string, date: string): Promise<number | null> {
    try {
        const url = `https://api.polygon.io/v1/open-close/${formattedTicker}/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);
        if (!res.ok) {
            // console.warn(`Error ${res.status} for ${formattedTicker}`);
            return null;
        }
        const data: any = await res.json();
        return typeof data.close === 'number' ? data.close : null;
    } catch { return null; }
}

async function main() {
    console.log("=== FIXING OPTIONS (POLYGON FORMAT) ===");

    // 1. Get Option Symbols from Transactions
    const userRefs = await db.collection('users').listDocuments();
    const optionSymbols = new Set<string>();

    for (const userRef of userRefs) {
        const snap = await userRef.collection('transactions').get();
        snap.forEach(d => {
            const sym = d.data().symbol;
            if (sym.includes(' ')) optionSymbols.add(sym);
        });
    }

    const symbols = Array.from(optionSymbols);
    console.log(`Found ${symbols.length} potential option symbols.`);

    // 2. Repair dates for them (Last 5 days + Expiration?)
    // For expired options, we should check around expiration date?
    // User Requirement: "2-year window... avoid requests older than Feb 2024".
    // Strategy: Just fix "Recent Gaps" (Last 10 days) if valid.
    // AND if the option EXPIRES in the future, check recent.
    // If it expired recently, check expiration.

    // Simplification: Check last 10 days for ALL options identified provided date >= Feb 1 2024.

    const dates = [
        '2026-02-06', '2026-02-05', '2026-02-04', '2026-02-03', '2026-02-02'
    ];

    for (const sym of symbols) {
        const polyTicker = toPolygonTicker(sym);
        if (polyTicker === sym) continue; // Not an option format we recognize

        console.log(`Checking ${sym} -> ${polyTicker}`);

        for (const date of dates) {
            const price = await fetchPolygonEod(polyTicker, date);
            if (price !== null) {
                await db.collection('officialCloses').doc(`${date}_${sym}`).set({
                    symbol: sym, // Keep internally as readable format
                    date: date,
                    tradingDate: date,
                    close: price,
                    status: 'ok',
                    provider: 'polygon_option_repair',
                    retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`   ✅ Fixed ${date}: $${price}`);
            }
        }
    }
}

main();
