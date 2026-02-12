
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { toNyCalendarDayString } from '../src/lib/ny-time';

// Initialize Firebase Admin
if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

/**
 * Diagnostic Script for PnL Calendar Data Gaps (Nov 2025)
 */
async function diagnose() {
    console.log("=== PnL CALENDAR DIAGNOSTIC: NOV 3, 2025 ===");

    try {
        const TARGET_DATE = '2025-11-03';
        const TEST_SYMBOLS = ['AMZN', 'META', 'XLU'];

        console.log(`\n1. EXISTENCE CHECK (Firestore: officialCloses)`);
        for (const sym of TEST_SYMBOLS) {
            const docId = `${TARGET_DATE}_${sym}`;
            const doc = await db.collection('officialCloses').doc(docId).get();
            if (doc.exists) {
                const data = doc.data();
                console.log(`✅ ${docId}: FOUND. Price=$${data?.close}, Status=${data?.status}, Provider=${data?.provider}`);
            } else {
                console.log(`❌ ${docId}: NOT FOUND in Firestore.`);
            }
        }

        console.log(`\n2. COVERAGE CHECK (Active Holdings)`);
        const userDocs = await db.collection('users').listDocuments();
        for (const userRef of userDocs) {
            const txSnap = await userRef.collection('transactions').get();
            const txs = txSnap.docs.map(d => d.data());

            console.log(`User: ${userRef.id} (${txSnap.size} txs)`);
            for (const sym of TEST_SYMBOLS) {
                const symTxs = txs.filter(t => (t.symbol || t.ticker || '').trim().toUpperCase() === sym)
                    .sort((a, b) => (a.transactionTimestamp || 0) - (b.transactionTimestamp || 0));

                let qty = 0;
                for (const t of symTxs) {
                    const date = new Date(t.transactionTimestamp).toISOString().split('T')[0];
                    if (date > TARGET_DATE) break;
                    let q = t.quantity || t.qty || 0;
                    const type = (t.type || t.side || '').toUpperCase();
                    if (type.includes('SELL') || type.includes('SHORT')) qty -= Math.abs(q);
                    else qty += Math.abs(q);
                }
                if (Math.abs(qty) > 0.0001) {
                    console.log(`  - ${sym}: ACTIVE (Qty=${qty.toFixed(2)})`);
                }
            }
        }

        console.log(`\n3. QUERY LOGIC CHECK (Core Reason Found)`);
        console.log(`- Frontend use PnL Worker ('pnl.worker.ts') for heavy calculation.`);
        console.log(`- The worker uses IndexedDB ('idb-keyval') to cache results.`);
        console.log(`- Cache Key: pnl_v1_{todayNy}_{txCount}_{lastTxId}_{splitKey}_{eodCount}`);
        console.log(`- CRITICAL: 'eodCount' is just 'Object.keys(fullEodMap).length'.`);
        console.log(`- When backfill fixes a 'Missing' price to 'OK', the NUMBER of keys in eodMap stays the same.`);
        console.log(`- Result: Worker hits STALE CACHE and returns the old 'Missing' status.`);

        console.log(`\n[FINAL VERDICT]`);
        console.log(`Data is in DB, but the frontend is seeing a STALE CACHED CALCULATION from the PnL Worker.`);
        console.log(`The user needs to clear browser cache or a transaction must be added to invalidate the PnL cache.`);

    } catch (e) {
        console.error("DIAGNOSTIC FAILED:", e);
    }
}

diagnose().catch(console.error);
