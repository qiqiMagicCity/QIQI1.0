
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

const TARGETS = [
    'APP', 'APPX', 'ADBG', 'BBAI', 'BDMD',
    'AAPL 260206 C 270' // Specific option check
];

async function fetchPolygonEod(symbol: string, date: string): Promise<number | null> {
    try {
        const url = `https://api.polygon.io/v1/open-close/${symbol}/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data: any = await res.json();
        return typeof data.close === 'number' ? data.close : null;
    } catch { return null; }
}

async function main() {
    console.log("=== FORCE REPAIR TARGETS ===");

    // Dates to check: Last 5 trading days
    const dates = [
        '2026-02-06', '2026-02-05', '2026-02-04', '2026-02-03', '2026-02-02'
    ];

    for (const sym of TARGETS) {
        console.log(`Processing ${sym}...`);

        let fixed = false;

        // Try dates
        for (const date of dates) {
            const price = await fetchPolygonEod(sym, date);
            if (price !== null) {
                await db.collection('officialCloses').doc(`${date}_${sym}`).set({
                    symbol: sym,
                    date: date,
                    tradingDate: date,
                    close: price,
                    status: 'ok',
                    provider: 'polygon_force_repair',
                    retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`   ✅ Fixed ${date}: $${price}`);
                fixed = true;
            } else {
                console.log(`   ⚠️ No data for ${date}`);
            }
        }
    }
}

main();
