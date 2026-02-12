
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
// import fetch from 'node-fetch'; // Native fetch in Node 18+

const db = getFirestore();
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

// Helper to determine if symbol is stock (simple check)
const isStock = (s: string) => /^[A-Z]+$/.test(s) && s.length < 10;

/**
 * Fetch EOD from Polygon
 * Docs: https://polygon.io/docs/stocks/get_v2_aggs_ticker__stocksTicker__range__multiplier___timespan___from___to
 */
async function fetchPolygonEod(symbol: string, date: string): Promise<number | null> {
    try {
        // Use v2/aggs for better historical coverage (Stock 10y+, Option 2y)
        const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&sort=asc&limit=1&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);

        if (!res.ok) {
            // 403/404 is common for old options or holidays
            if (res.status !== 404 && res.status !== 403) {
                console.warn(`Polygon Fetch Error ${res.status} for ${symbol} on ${date}: ${res.statusText}`);
            }
            return null;
        }

        const data: any = await res.json();

        if (data.results && data.results.length > 0) {
            return data.results[0].c; // Close price from Aggs
        }

        return null;
    } catch (e: any) {
        console.error(`Polygon Exception for ${symbol}:`, e.message);
        return null;
    }
}

export const repairEodSymbol = functions.https.onCall(async (data: any, context: any) => {
    // data: { symbol: string, missingDates?: string[], purge?: boolean }
    const { symbol, purge } = data;
    if (!symbol) return { success: false, message: 'No symbol provided' };

    const missingDates: string[] = data.missingDates || [];

    // STRATEGY PART 1: PURGE DIRTY DATA
    // "Cleanse dirty data (via_tx) before repair"
    let purgedCount = 0;
    if (purge) {
        const batch = db.batch();
        let ops = 0;
        for (const d of missingDates) {
            const ref = db.collection('officialCloses').doc(`${d}_${symbol}`);
            const snap = await ref.get();
            if (snap.exists) {
                const dat = snap.data();
                if (dat?.provider === 'via_tx' || dat?.provider === 'manual_dirty') {
                    batch.delete(ref);
                    ops++;
                    purgedCount++;
                }
                // If we find any 'manual_dirty' or bad provider, we nuke it.
            }
        }
        if (ops > 0) await batch.commit();
    }

    if (missingDates.length === 0) return { success: true, count: 0, purged: purgedCount, message: 'No dates to repair' };

    // STRATEGY PART 2 & 3: REPAIR
    try {
        missingDates.sort(); // Chronological

        let batch = db.batch();
        let writeOps = 0;
        let fixCount = 0;

        const isOpt = !isStock(symbol);
        const OPTION_START_DATE = '2024-02-01'; // Polygon Option History Limit

        // Batch processing for high speed (Polygon Paid)
        const FETCH_CONCURRENCY = 20;

        for (let i = 0; i < missingDates.length; i += FETCH_CONCURRENCY) {
            const chunk = missingDates.slice(i, i + FETCH_CONCURRENCY);

            // Parallel Fetch
            const results = await Promise.all(chunk.map(async (date) => {
                if (isOpt && date < OPTION_START_DATE) return null;
                const price = await fetchPolygonEod(symbol, date);
                return price !== null ? { date, price } : null;
            }));

            // Sync Write
            for (const res of results) {
                if (!res) continue;

                const ref = db.collection('officialCloses').doc(`${res.date}_${symbol}`);
                batch.set(ref, {
                    symbol: symbol,
                    date: res.date,
                    tradingDate: res.date,
                    close: res.price,
                    status: 'ok',
                    provider: 'polygon_massive', // BRANDED QUALITY
                    retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                writeOps++;
                fixCount++;

                if (writeOps >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    writeOps = 0;
                }
            }
        }

        if (writeOps > 0) {
            await batch.commit();
        }

        return { success: true, count: fixCount, purged: purgedCount, symbol };

    } catch (e: any) {
        console.error(`Repair failed for ${symbol}:`, e);
        return { success: false, error: e.message };
    }
});
