
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

// --- Utilities ---
const normalizeSymbol = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

const US_MARKET_HOLIDAYS = new Set([
    '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
    '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
    '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
    '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
    '2026-01-01', '2026-01-19'
]);

function isTradingDay(dayStr: string): boolean {
    const [y, m, d] = dayStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const wd = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    return wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(dayStr);
}

async function auditSystemIntegrity() {
    console.log("=== GLOBAL SYSTEM INTEGRITY AUDIT STARTED ===");

    // 1. Fetch all Official Closes (IDs only)
    console.log("Fetching all Firestore EOD record IDs (150k+)...");
    const existingIds = new Set<string>();
    const closesSnap = await db.collection('officialCloses').select().get();
    closesSnap.forEach(doc => existingIds.add(doc.id));
    console.log(`- Loaded ${existingIds.size} existing EOD IDs.`);

    // 2. Scan all Users & Transactions
    const requiredChecks = new Map<string, Set<string>>(); // Date -> Set<Symbols>
    const userDocs = await db.collection('users').listDocuments();
    console.log(`- Scanning ${userDocs.length} users for holdings history...`);

    const nowStr = new Date().toISOString().split('T')[0];

    for (const userRef of userDocs) {
        const uid = userRef.id;
        const txSnap = await userRef.collection('transactions').get();
        const txs = txSnap.docs.map(d => {
            const data = d.data();
            return {
                symbol: normalizeSymbol(data.symbol || data.ticker || ''),
                qty: Math.abs(data.quantity || data.qty || 0),
                type: (data.type || data.side || '').toUpperCase(),
                ts: data.transactionTimestamp
            };
        }).filter(t => t.symbol && t.ts).sort((a, b) => a.ts - b.ts);

        if (txs.length === 0) continue;

        const startDay = new Date(txs[0].ts).toISOString().split('T')[0];

        // Track symbol balances per day
        const symbolBalances = new Map<string, number>();
        let currentTs = txs[0].ts;
        let txIdx = 0;

        // Iterate through all days from start to now
        let curr = new Date(startDay);
        const endDay = new Date();

        while (curr <= endDay) {
            const dayStr = curr.toISOString().split('T')[0];

            // Apply all transactions for this day
            while (txIdx < txs.length) {
                const tx = txs[txIdx];
                const txDay = new Date(tx.ts).toISOString().split('T')[0];
                if (txDay > dayStr) break;

                let bal = symbolBalances.get(tx.symbol) || 0;
                if (tx.type.includes('SELL') || tx.type.includes('STOP') || tx.type.includes('SHORT')) {
                    bal -= tx.qty;
                } else {
                    bal += tx.qty;
                }
                symbolBalances.set(tx.symbol, bal);
                txIdx++;
            }

            // If it's a trading day, record requirements for active holdings
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

    // 3. Calculate Stats
    let totalSamples = 0;
    let missingCount = 0;
    const gaps: Record<string, string[]> = {};

    requiredChecks.forEach((syms, date) => {
        syms.forEach(sym => {
            totalSamples++;
            const id = `${date}_${sym}`;
            if (!existingIds.has(id)) {
                missingCount++;
                if (!gaps[date]) gaps[date] = [];
                gaps[date].push(sym);
            }
        });
    });

    const coverage = totalSamples > 0 ? ((totalSamples - missingCount) / totalSamples * 100) : 100;

    // 4. Report Results
    console.log("\n--- AUDIT REPORT ---");
    console.log(`GLOBAL COVERAGE: ${coverage.toFixed(2)}% (${totalSamples - missingCount}/${totalSamples})`);
    console.log(`TOTAL GAPS:      ${missingCount}`);

    if (missingCount > 0) {
        console.log("\n--- REST MISSING LIST (CHRONOLOGICAL) ---");
        const sortedDates = Object.keys(gaps).sort((a, b) => b.localeCompare(a));
        for (const date of sortedDates) {
            console.log(`[${date}] ${gaps[date].length} symbols: ${gaps[date].join(', ')}`);
        }
    } else {
        console.log("\nPERFECT: 100% Coverage Reached.");
    }
}

auditSystemIntegrity().catch(console.error);
