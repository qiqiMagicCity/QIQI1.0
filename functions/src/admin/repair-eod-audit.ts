
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';

// --- Helpers ---
const normalize = (s: string) => (s || '').toUpperCase().replace(/\s+/g, '');

// Generate array of YYYY-MM-DD
function getDates(start: string, end: string) {
    const arr = [];
    let d = new Date(start);
    const e = new Date(end);
    while (d <= e) {
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) {
            arr.push(d.toISOString().slice(0, 10));
        }
        d.setDate(d.getDate() + 1);
    }
    return arr;
}

export const repairEodAudit = functions.https.onCall(async (data: any, context: any) => {
    // Audit Logic: Find Missing EOD
    // Requires Admin
    // if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');

    const db = getFirestore();
    const globalTxMap: Record<string, Set<string>> = {}; // Sym -> Set<Dates>

    // 1. Load All Transactions to build required EOD map
    // Note: In production functions, listDocuments might be slow. 
    // We assume a reasonable number of users/transactions or use a collectionGroup index if available.
    // However, to match smart-global-repair-v2 logic:
    const userRefs = await db.collection('users').listDocuments();

    for (const ref of userRefs) {
        const txSnap = await ref.collection('transactions').get();
        const trSnap = await ref.collection('trades').get();

        const process = (doc: any) => {
            const d = doc.data();
            const sym = normalize(d.symbol);
            if (!sym) return;

            let date = d.date;
            if (!date && d.transactionTimestamp) date = new Date(d.transactionTimestamp).toISOString().slice(0, 10);
            if (!date) return;

            if (!globalTxMap[sym]) globalTxMap[sym] = new Set();
            globalTxMap[sym].add(date);
        };
        txSnap.forEach(process);
        trSnap.forEach(process);
    }

    const missingResults: { symbol: string, missingDates: string[], count: number }[] = [];
    const today = new Date().toISOString().slice(0, 10);

    // 2. Check each symbol
    const symbols = Object.keys(globalTxMap);

    // We can't batch read EVERYTHING in one go easily without massive memory.
    // But we can check metadata or check if doc exists.
    // Optimized: For each symbol, check its date range in officialCloses.

    // Limit concurrency
    const BATCH_SIZE = 10;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const chunk = symbols.slice(i, i + BATCH_SIZE);
        await Promise.all(chunk.map(async (sym) => {
            const dates = Array.from(globalTxMap[sym]).sort();
            if (dates.length === 0) return;

            const start = dates[0];
            const end = today;
            const allRequiredDays = getDates(start, end);

            const missingDates: string[] = [];

            // Check existence logic. 
            // Reading 1000s of docs per symbol is heavy. 
            // Better strategy: list 'officialCloses' where symbol == sym? No, composite index issue.
            // Best strategy for now (robustness): Batch read by ID.

            const READ_BATCH = 30; // Check 30 days at a time
            for (let j = 0; j < allRequiredDays.length; j += READ_BATCH) {
                const dayBatch = allRequiredDays.slice(j, j + READ_BATCH);
                const refs = dayBatch.map(d => db.collection('officialCloses').doc(`${d}_${sym}`));
                const snaps = await db.getAll(...refs);

                snaps.forEach((snap, idx) => {
                    const d = dayBatch[idx];
                    let exists = snap.exists;
                    if (exists) {
                        const dat = snap.data();
                        if (!dat || (dat.status !== 'ok' && dat.close <= 0)) exists = false;
                    }
                    if (!exists) missingDates.push(d);
                });
            }

            if (missingDates.length > 0) {
                missingResults.push({ symbol: sym, missingDates, count: missingDates.length });
            }
        }));
    }

    const totalMissing = missingResults.reduce((acc, cur) => acc + cur.count, 0);
    return {
        totalMissing,
        details: missingResults
    };
});
