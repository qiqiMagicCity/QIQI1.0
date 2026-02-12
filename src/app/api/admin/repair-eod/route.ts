
import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { initializeFirebaseAdmin } from '@/lib/firebase-admin';

// Initialize Admin
initializeFirebaseAdmin();
const db = admin.firestore();

const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

// Helper to determine if symbol is stock (simple check)
const isStock = (s: string) => /^[A-Z]+$/.test(s) && s.length < 10;

/**
 * Fetch EOD from Polygon (v2/aggs)
 */
async function fetchPolygonEod(symbol: string, date: string): Promise<number | null> {
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&sort=asc&limit=1&apiKey=${POLYGON_KEY}`;

    // DEBUG: Log the request (Masked Key)
    console.log(`[Polygon Fetch] Requesting: ${url.replace(POLYGON_KEY, '***')}`);

    try {
        const res = await fetch(url);

        if (!res.ok) {
            console.error(`[Polygon Fetch Error] Status: ${res.status} ${res.statusText}`);
            try {
                const text = await res.text();
                console.error(`[Polygon Fetch Error] Body:`, text);
            } catch (readErr) {
                console.error(`[Polygon Fetch Error] Could not read body:`, readErr);
            }

            return null;
        }

        const data: any = await res.json();

        if (data.results && data.results.length > 0) {
            return data.results[0].c; // Close price from Aggs
        }

        console.log(`[Polygon Fetch] No results for ${symbol} on ${date}. Status: ${data.status}`);
        return null;
    } catch (e: any) {
        console.error(`[Polygon Exception] Critical Error for ${symbol} on ${date}:`);
        console.error(e);
        if (e.cause) console.error('Caused by:', e.cause);
        return null;
    }
}

export async function POST(request: Request) {
    console.log('--- [Repair API] Request Received ---');
    console.log(`[Debug] POLYGON_KEY Length: ${POLYGON_KEY?.length || 0}`);
    console.log(`[Debug] POLYGON_KEY First 5 chars: ${POLYGON_KEY?.substring(0, 5)}...`);
    // Node.js environments often use these for proxy
    console.log(`[Debug] HTTP_PROXY: ${process.env.HTTP_PROXY || 'None'}`);
    console.log(`[Debug] HTTPS_PROXY: ${process.env.HTTPS_PROXY || 'None'}`);

    try {
        const body = await request.json();
        const { symbol, missingDates, purge } = body;

        console.log(`[Repair API] Processing Symbol: ${symbol}, Dates: ${missingDates?.length}, Purge: ${purge}`);

        if (!symbol) {
            return NextResponse.json({ success: false, message: 'No symbol provided' }, { status: 400 });
        }

        const dates: string[] = missingDates || [];
        if (dates.length === 0) {
            return NextResponse.json({ success: true, count: 0, message: 'No dates to repair' });
        }

        // STRATEGY PART 1: PURGE DIRTY DATA
        let purgedCount = 0;
        if (purge) {
            const batch = db.batch();
            let ops = 0;
            for (const d of dates) {
                const ref = db.collection('officialCloses').doc(`${d}_${symbol}`);
                const snap = await ref.get();
                if (snap.exists) {
                    const dat = snap.data();
                    if (dat?.provider === 'via_tx' || dat?.provider === 'manual_dirty') {
                        batch.delete(ref);
                        ops++;
                        purgedCount++;
                    }
                }
            }
            if (ops > 0) await batch.commit();
        }

        // STRATEGY PART 2 & 3: REPAIR
        dates.sort(); // Chronological

        let batch = db.batch();
        let writeOps = 0;
        let fixCount = 0;

        const isOpt = !isStock(symbol);
        const OPTION_START_DATE = '2024-02-01'; // Polygon Option History Limit

        // Batch processing - Concurrency: 20
        const FETCH_CONCURRENCY = 20;

        for (let i = 0; i < dates.length; i += FETCH_CONCURRENCY) {
            const chunk = dates.slice(i, i + FETCH_CONCURRENCY);
            console.log(`[Repair API] Processing chunk ${(i / FETCH_CONCURRENCY) + 1}...`);

            const results = await Promise.all(chunk.map(async (date) => {
                if (isOpt && date < OPTION_START_DATE) return null;
                const price = await fetchPolygonEod(symbol, date);
                return price !== null ? { date, price } : null;
            }));

            for (const res of results) {
                if (!res) continue;

                const ref = db.collection('officialCloses').doc(`${res.date}_${symbol}`);
                batch.set(ref, {
                    symbol: symbol,
                    date: res.date,
                    tradingDate: res.date,
                    close: res.price,
                    status: 'ok',
                    provider: 'polygon_massive',
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

        console.log(`[Repair API] Finished repair for ${symbol}. Fixed: ${fixCount}, Purged: ${purgedCount}`);

        return NextResponse.json({ success: true, count: fixCount, purged: purgedCount, symbol });

    } catch (error: any) {
        console.error('--- [Repair API CRITICAL ERROR] ---');
        console.error(error);
        if (error.stack) console.error('Stack:', error.stack);
        if (error.cause) console.error('Cause:', error.cause);

        return NextResponse.json({
            success: false,
            error: error.message,
            stack: error.stack,
            details: JSON.stringify(error, Object.getOwnPropertyNames(error))
        }, { status: 500 });
    }
}
