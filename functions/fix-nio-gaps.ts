
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Helper: Generate date range
function getTradingDays(start: string, end: string) {
    const dates = [];
    let d = new Date(start);
    const e = new Date(end);
    while (d <= e) {
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) {
            dates.push(d.toISOString().slice(0, 10));
        }
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

async function run() {
    console.log("=== TARGETED GAP REPAIR: NIO260618P3.5 ===");

    // 1. Define Target
    const symbol = 'NIO260618P3.5';
    // Start significantly before the reported missing dates (Nov 2025)
    // Let's assume start of 2025 or the user's first trade.
    // We'll read existing history to find the 'Edge'.

    console.log(`Fetching history for ${symbol}...`);
    const snap = await db.collection('officialCloses')
        .where('symbol', '==', symbol)
        .orderBy('date')
        .get();

    if (snap.empty) {
        console.log("No history found for this symbol. Cannot auto-heal without seed.");
        return;
    }

    const map: Record<string, number> = {};
    const dates: string[] = [];

    snap.forEach(doc => {
        const d = doc.data();
        if (d.status === 'ok' && d.close) {
            map[d.date] = d.close;
            dates.push(d.date);
        }
    });

    // 2. Determine Range
    dates.sort();
    const minDate = dates[0];
    const maxDate = new Date().toISOString().slice(0, 10);
    console.log(`History Range: ${minDate} -> ${maxDate}`);
    console.log(`Known Data Points: ${dates.length}`);

    // 3. Scan for Gaps
    const allDays = getTradingDays(minDate, maxDate);
    const missing: string[] = [];

    let lastPrice = 0;
    // Initialize lastPrice with first known
    lastPrice = map[minDate];

    const updates: any[] = [];

    for (const day of allDays) {
        if (map[day]) {
            lastPrice = map[day];
        } else {
            // Missing!
            // console.log(`Gap found: ${day}`);

            // Forward Fill
            if (lastPrice > 0) {
                updates.push({
                    date: day,
                    symbol: symbol,
                    price: lastPrice
                });
                // Does NOT update 'map' or 'lastPrice' here?
                // YES, Forward Fill means we assume price stays same.
                // So next day naturally uses this 'lastPrice'.
            }
        }
    }

    console.log(`Found ${updates.length} gaps to fill.`);

    // 4. Commit
    if (updates.length > 0) {
        const batch = db.batch();
        updates.forEach(u => {
            const ref = db.collection('officialCloses').doc(`${u.date}_${u.symbol}`);
            batch.set(ref, {
                date: u.date,
                symbol: u.symbol,
                close: u.price,
                tradingDate: u.date,
                status: 'ok',
                provider: 'audit_targeted_repair',
                note: 'Targeted Gap Fill',
                retrievedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });
        await batch.commit();
        console.log("Commited fixes.");
    }
}

run();
