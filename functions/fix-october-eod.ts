
import * as admin from 'firebase-admin';
import yahooFinance from 'yahoo-finance2';

// 1. Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// 2. Configuration
const TARGET_MONTH_START = '2025-10-01';
const TARGET_MONTH_END = '2025-10-31';
const CONCURRENCY = 5;
const DELAY_MS = 1000; // Slower is safer for local script

// Helper: Generate trading days (Mon-Fri) for range
function getTradingDays(startStr: string, endStr: string): string[] {
    const dates: string[] = [];
    let curr = new Date(startStr);
    const end = new Date(endStr);

    // Adjust to avoid timezone issues, treat input as UTC midnight roughly
    curr.setUTCHours(12, 0, 0, 0);
    end.setUTCHours(12, 0, 0, 0);

    while (curr <= end) {
        const day = curr.getUTCDay();
        if (day !== 0 && day !== 6) { // Skip Sun, Sat
            const y = curr.getUTCFullYear();
            const m = String(curr.getUTCMonth() + 1).padStart(2, '0');
            const d = String(curr.getUTCDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${d}`);
        }
        curr.setDate(curr.getDate() + 1);
    }
    return dates;
}

// Helper: Get Unique Symbols from User Transactions
async function getUserSymbols(): Promise<string[]> {
    console.log('🔍 Scanning available users for symbols...');
    // In a real generic script we might scan all users, but here let's try to find the active user or scan all 'users' collection generally?
    // Scanning all users/{uid}/transactions is expensive.
    // Let's assume we have a way to know, or just scan all 'transactions' group collection if index exists.
    // Lacking group index, we will list users first.

    const users = await db.collection('users').listDocuments();
    const symbols = new Set<string>();

    console.log(`Found ${users.length} users. Scanning transactions...`);

    for (const user of users) {
        const txs = await user.collection('transactions').get();
        txs.forEach(doc => {
            const indexSymbol = doc.data().symbol;
            if (indexSymbol && typeof indexSymbol === 'string') {
                // Filter out options roughly
                if (indexSymbol.length < 10) {
                    symbols.add(indexSymbol.toUpperCase().trim());
                }
            }
        });
    }

    const sorted = Array.from(symbols).sort();
    console.log(`✅ Found ${sorted.length} unique symbols: ${sorted.join(', ')}`);
    return sorted;
}

// Helper: Fetch Yahoo
async function fetchYahooEod(symbol: string, dateStr: string) {
    try {
        // Yahoo query: period1=date, period2=date+1 day
        const d = new Date(dateStr);
        d.setUTCHours(0, 0, 0, 0);
        const next = new Date(d);
        next.setDate(next.getDate() + 2); // +2 days buffer to ensure we cover the close

        const result = await yahooFinance.historical(symbol, {
            period1: dateStr, // Yahoo parser is smart enough
            period2: next.toISOString().split('T')[0],
            interval: '1d'
        });

        // Find exact date match
        const match = result.find(r => r.date.toISOString().startsWith(dateStr));
        if (match && match.close) {
            return {
                status: 'ok',
                close: match.close,
                currency: 'USD' // Assumption for US stocks
            };
        }
        return { status: 'missing_vendor', error: 'No data returned for date' };

    } catch (e: any) {
        return { status: 'error', error: e.message };
    }
}

async function main() {
    console.log(`🚀 STARTING TARGETED BACKFILL: ${TARGET_MONTH_START} to ${TARGET_MONTH_END}`);

    const symbols = await getUserSymbols();
    const dates = getTradingDays(TARGET_MONTH_START, TARGET_MONTH_END);
    console.log(`📅 Target Dates (${dates.length}): ${dates.join(', ')}`);

    // Build Tasks
    const queue: { symbol: string, date: string }[] = [];

    console.log('🧐 Checking existing records to skip...');
    // Optimization: Check existence efficiently? 
    // Doing 1 by 1 check for SYMBOLS * DATES might be slow (e.g. 20 syms * 22 days = 440 checks)
    // Firestore batch get is limited to 30 keys? No, getAll is variadic but limited.
    // Let's just check one by one in parallel with limit.

    // We will just push ALL candidates to queue, and check existence inside the worker to keep simple.
    for (const s of symbols) {
        for (const d of dates) {
            queue.push({ symbol: s, date: d });
        }
    }
    console.log(`📝 Total Candidate Tasks: ${queue.length}`);

    // Process Queue
    let processed = 0;
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i += CONCURRENCY) {
        const chunk = queue.slice(i, i + CONCURRENCY);

        await Promise.all(chunk.map(async (task) => {
            const docId = `${task.date}_${task.symbol}`;
            const docRef = db.collection('officialCloses').doc(docId);

            // 1. Check Existence
            const doc = await docRef.get();
            if (doc.exists && doc.data()?.status === 'ok') {
                process.stdout.write('.'); // Skipped
                skipped++;
                return;
            }

            // 2. Fetch
            // Delay for rate limit
            await new Promise(r => setTimeout(r, DELAY_MS));

            const res = await fetchYahooEod(task.symbol, task.date);

            // 3. Save
            if (res.status === 'ok' && res.close) {
                await docRef.set({
                    status: 'ok',
                    close: res.close,
                    symbol: task.symbol,
                    tradingDate: task.date,
                    date: task.date, // legacy
                    source: 'script_fix_october',
                    provider: 'yahoo_local',
                    currency: res.currency,
                    retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                process.stdout.write('✅');
                console.log(`\nFixed: ${task.symbol} @ ${task.date} = ${res.close}`);
                success++;
            } else {
                // If missing_vendor, we can write that too to prevent retry
                if (res.status === 'missing_vendor') {
                    await docRef.set({
                        status: 'missing_vendor',
                        symbol: task.symbol,
                        tradingDate: task.date,
                        source: 'script_fix_october',
                        provider: 'yahoo_local',
                        note: 'Yahoo returned no matching date row',
                        retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    process.stdout.write('ø'); // Missing
                } else {
                    process.stdout.write('❌'); // Error
                    console.log(`\nFailed: ${task.symbol} @ ${task.date} -> ${res.error}`);
                    failed++;
                }
            }
        }));

        processed += chunk.length;
        // console.log(` Progress: ${processed}/${queue.length}`);
    }

    console.log('\n\n🏁 MISSION COMPLETE');
    console.log(`Total: ${queue.length}`);
    console.log(`Skipped (Already OK): ${skipped}`);
    console.log(`Fixed (Success): ${success}`);
    console.log(`Failed/Missing: ${failed}`);
    process.exit(0);
}

main();
