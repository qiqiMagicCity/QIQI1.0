
import * as admin from 'firebase-admin';
import yahooFinance from 'yahoo-finance2';

// Initialize Firebase
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

const TARGET_DATES = ['2025-10-22', '2025-10-23', '2025-10-24', '2025-10-27'];

async function getUniqueSymbols(): Promise<string[]> {
    console.log('🔍 Scanning users for symbols...');
    const users = await db.collection('users').listDocuments();
    const symbols = new Set<string>();

    for (const user of users) {
        const txs = await user.collection('transactions').get();
        txs.forEach(doc => {
            const s = doc.data().symbol;
            if (s && typeof s === 'string' && s.length < 10) {
                symbols.add(s.toUpperCase().trim());
            }
        });
    }
    const sorted = Array.from(symbols).sort();
    console.log(`✅ Found ${sorted.length} unique symbols.`);
    return sorted;
}

async function diagnose() {
    console.log(`🚑 DIAGNOSING GAPS FOR: ${TARGET_DATES.join(', ')}`);
    const symbols = await getUniqueSymbols();

    const missing: { symbol: string, date: string, reason: string }[] = [];

    console.log('📂 Checking Firestore officialCloses...');

    // Check all combinations
    // To speed up, we can do parallel reads
    const tasks = [];
    for (const sym of symbols) {
        for (const date of TARGET_DATES) {
            tasks.push({ sym, date });
        }
    }

    // Process in chunks to avoid memory issues if too many, but here ~50 * 4 = 200 checks, fine.
    const CONCURRENCY = 20;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const chunk = tasks.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (t) => {
            const docId = `${t.date}_${t.sym}`;
            const snap = await db.collection('officialCloses').doc(docId).get();

            if (!snap.exists) {
                missing.push({ symbol: t.sym, date: t.date, reason: 'Doc Missing' });
            } else {
                const data = snap.data();
                if (data?.status !== 'ok') {
                    missing.push({ symbol: t.sym, date: t.date, reason: `Status: ${data?.status}` });
                } else if (!data.close || data.close <= 0) {
                    missing.push({ symbol: t.sym, date: t.date, reason: `Invalid Close: ${data.close}` });
                }
            }
        }));
    }

    if (missing.length === 0) {
        console.log('✅ NO GAPS FOUND. All requested dates/symbols have valid OK data.');
    } else {
        console.log(`❌ FOUND ${missing.length} GAPS.`);
        // Print first 10
        missing.slice(0, 10).forEach(m => console.log(`   - ${m.date} ${m.symbol}: ${m.reason}`));
        if (missing.length > 10) console.log(`   ... and ${missing.length - 10} more.`);

        // DIAGNOSE FIRST ONE
        const target = missing[0];
        console.log(`\n🩺 DIAGNOSING FIRST FAILURE: ${target.symbol} @ ${target.date}`);
        console.log(`   Calling Yahoo Finance API directly...`);

        try {
            // Yahoo query logic
            const queryOptions = {
                period1: target.date,
                period2: new Date(new Date(target.date).getTime() + 86400000 * 2).toISOString().split('T')[0], // +2 days
                interval: '1d' as const // explicit type
            };

            console.log(`   Query Params:`, queryOptions);
            const result = await yahooFinance.historical(target.symbol, queryOptions);

            console.log('   >>> API RESPONSE (Raw):');
            console.dir(result, { depth: null, colors: true });

            if (result.length > 0) {
                const match = result.find(r => r.date.toISOString().startsWith(target.date));
                if (match) {
                    console.log(`   ✅ API HAS DATA! Close = ${match.close}`);
                    console.log(`   CONCLUSION: The data EXISTS at source. The issue is in the BACKFILL WRITE PROCESS.`);
                } else {
                    console.log(`   ❌ API returned data but NOT for ${target.date}. (Returned dates: ${result.map(r => r.date.toISOString().split('T')[0]).join(', ')})`);
                    console.log(`   CONCLUSION: API has data nearby, but maybe not on this specific date? Or Timezone misalignment.`);
                }
            } else {
                console.log(`   ❌ API returned EMPTY array.`);
                console.log(`   CONCLUSION: Data truly missing at source for this range.`);
            }

        } catch (e: any) {
            console.log(`   ❌ API EXCEPTION:`);
            console.log(e.message || e);
            if (e.message?.includes('Not Found')) {
                console.log(`   CONCLUSION: Symbol changed or delisted?`);
            }
        }
    }

    process.exit(0);
}

diagnose();
