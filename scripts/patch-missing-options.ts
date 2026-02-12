
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

const US_MARKET_HOLIDAYS = new Set([
    '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
    '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
    '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
    '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
    '2026-01-01', '2026-01-19'
]);

const normalizeSymbol = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

function isTradingDay(dayStr: string): boolean {
    const [y, m, d] = dayStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const wd = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    return wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(dayStr);
}

async function patchMissingOptions() {
    console.log("=== PATCH MISSING OPTIONS: START ===");

    // 1. Load existing data for lookup
    console.log("Fetching existing EOD IDs...");
    const existingIds = new Set<string>();
    const closesSnap = await db.collection('officialCloses').select().get();
    closesSnap.forEach(doc => existingIds.add(doc.id));
    console.log(`- Loaded ${existingIds.size} existing records.`);

    // 2. Identify Gaps
    const requiredChecks = new Map<string, Set<string>>(); // Date -> Set<Symbols>
    const userDocs = await db.collection('users').listDocuments();

    // Also track cost prices for symbols
    const symbolPriceMap = new Map<string, number>();

    for (const userRef of userDocs) {
        const txSnap = await userRef.collection('transactions').get();
        const txs = txSnap.docs.map(d => {
            const data = d.data();
            return {
                symbol: normalizeSymbol(data.symbol || data.ticker || ''),
                qty: Math.abs(data.quantity || data.qty || 0),
                price: data.price || 0,
                type: (data.type || data.side || '').toUpperCase(),
                ts: data.transactionTimestamp
            };
        }).filter(t => t.symbol && t.ts).sort((a, b) => a.ts - b.ts);

        if (txs.length === 0) continue;

        const startDay = new Date(txs[0].ts).toISOString().split('T')[0];
        const symbolBalances = new Map<string, number>();
        let txIdx = 0;
        let curr = new Date(startDay);
        const endDay = new Date();

        while (curr <= endDay) {
            const dayStr = curr.toISOString().split('T')[0];
            while (txIdx < txs.length) {
                const tx = txs[txIdx];
                const txDay = new Date(tx.ts).toISOString().split('T')[0];
                if (txDay > dayStr) break;

                let bal = symbolBalances.get(tx.symbol) || 0;
                if (tx.type.includes('SELL') || tx.type.includes('SHORT')) bal -= tx.qty;
                else {
                    bal += tx.qty;
                    // Seed price if not set
                    if (!symbolPriceMap.has(tx.symbol) || symbolPriceMap.get(tx.symbol) === 0) {
                        symbolPriceMap.set(tx.symbol, tx.price);
                    }
                }
                symbolBalances.set(tx.symbol, bal);
                txIdx++;
            }

            if (isTradingDay(dayStr)) {
                for (const [sym, bal] of symbolBalances.entries()) {
                    if (Math.abs(bal) > 0.0001) {
                        if (!requiredChecks.has(dayStr)) requiredChecks.set(dayStr, new Set());
                        requiredChecks.get(dayStr)!.add(sym);
                    }
                }
            }
            curr.setDate(curr.getDate() + 1);
        }
    }

    // 3. Process Gaps
    const gaps: { date: string, sym: string }[] = [];
    requiredChecks.forEach((syms, date) => {
        syms.forEach(sym => {
            if (!existingIds.has(`${date}_${sym}`)) {
                gaps.push({ date, sym });
            }
        });
    });

    console.log(`Found ${gaps.length} gaps to patch.`);

    const PLAN_LIMIT_DATE = '2024-02-01';
    let patchedCount = 0;
    const batchSize = 100;

    // Cache for carry forward
    const lastValidPrice = new Map<string, number>();

    // Sort gaps chronologically to allow carry forward
    gaps.sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 0; i < gaps.length; i += batchSize) {
        const chunk = gaps.slice(i, i + batchSize);
        const batch = db.batch();

        for (const gap of chunk) {
            const docId = `${gap.date}_${gap.sym}`;
            let price = 0;
            let status: 'plan_limited' | 'no_liquidity' = 'no_liquidity';

            if (gap.date < PLAN_LIMIT_DATE) {
                status = 'plan_limited';
                price = lastValidPrice.get(gap.sym) || symbolPriceMap.get(gap.sym) || 0;
            } else {
                status = 'no_liquidity';
                // Try carry forward from our memory
                price = lastValidPrice.get(gap.sym) || 0;

                // If not in memory, try to find the last known OK price from Firestore
                if (!price) {
                    const lastDoc = await db.collection('officialCloses')
                        .where('symbol', '==', gap.sym)
                        .where('tradingDate', '<', gap.date)
                        .orderBy('tradingDate', 'desc')
                        .limit(1)
                        .get();

                    if (!lastDoc.empty) {
                        price = lastDoc.docs[0].data().close || 0;
                    }
                }

                // Final fallback to cost price
                if (!price) price = symbolPriceMap.get(gap.sym) || 0;
            }

            // If still no price, we have to look up DB for last known OK price
            if (price === 0) {
                // Not ideal in batch, but we can't do much without a base.
                // For now, let's use a 0.01 placeholder or something visible? 
                // User said "temporarily fill with 0 or null". 
                // Let's use 0.
            }

            batch.set(db.collection('officialCloses').doc(docId), {
                tradingDate: gap.date,
                symbol: gap.sym,
                close: price,
                status: status,
                provider: 'patch_script',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                isEstimated: true
            });

            // [INTEGRITY] Increment eodRevision for this symbol
            batch.set(db.collection('stockDetails').doc(gap.sym), {
                eodRevision: admin.firestore.FieldValue.increment(1),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            lastValidPrice.set(gap.sym, price);
            patchedCount++;
        }

        await batch.commit();
        console.log(`Patched batch ${Math.floor(i / batchSize) + 1}...`);
    }

    console.log(`\n=== COMPLETED: ${patchedCount} Gaps Patched ===`);
}

patchMissingOptions().catch(console.error);
