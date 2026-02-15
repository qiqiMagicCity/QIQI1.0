
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { calculateTransactionStats } from './src/lib/analytics/transaction-analytics'; // We might need to mock this or just inspect raw
import { calcGlobalFifo } from './src/lib/pnl/calc-m4-m5-2-global-fifo'; // We need this logic
import { normalizeFireTx } from './src/hooks/use-user-transactions'; // Need this to normalize

// Mock Context stuffs
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';
const SNAPSHOT_ID = '2025-08-31';

try {
    const serviceAccount = require('./service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();

// Helper to normalize (simplified from hook)
function normalizeTx(doc: any) {
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        transactionTimestamp: data.transactionTimestamp?.toMillis ? data.transactionTimestamp.toMillis() : data.transactionTimestamp
    };
}

async function verifyLiveState() {
    console.log("=== SERVER STATE VERIFICATION ===");

    // E1: Check Snapshot on Server
    const snapRef = db.doc(`users/${TARGET_UID}/snapshots/${SNAPSHOT_ID}`);
    const snapDoc = await snapRef.get(); // Admin SDK alwaysd reads from server

    console.log(`\n[E1] Snapshot ${SNAPSHOT_ID} Status:`);
    if (!snapDoc.exists) {
        console.log("❌ Snapshot missing!");
    } else {
        const data = snapDoc.data();
        const abnbInv = data?.inventory?.['ABNB'];
        console.log(` - inventory.ABNB exists? ${!!abnbInv}`);
        if (abnbInv) console.log(` - Content: ${JSON.stringify(abnbInv)}`);
        console.log(` - UpdatedAt: ${data?.updatedAt}`);
    }

    // E2: Re-run Calc to see Audit Trail
    console.log(`\n[E2] Audit Trail Reconstruction (2026 Focus):`);

    // Fetch ALL transactions (to be safe)
    const txsSnap = await db.collection(`users/${TARGET_UID}/transactions`).get();
    const tradesSnap = await db.collection(`users/${TARGET_UID}/trades`).get();

    let allTxs = [
        ...txsSnap.docs.map(normalizeTx),
        ...tradesSnap.docs.map(normalizeTx)
    ];

    // Normalize using our known logic (rudimentary version for script)
    // We need to ensure we catch the Short Sell
    // 2026-02-12 15:58:00 ABNB Sell Short 555@115.7263
    const abnbTxs = allTxs.filter(t => t.symbol === 'ABNB').sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    console.log(`Found ${abnbTxs.length} ABNB transactions.`);

    // Scan for the specific short
    const targetShort = abnbTxs.find(t => Math.abs(t.qty) === 555 && (t.price > 115 && t.price < 116));
    console.log("Target Short found in DB?", !!targetShort, targetShort?.id);

    // Run Mini-FIFO (Simulated)
    // We can't easily import the complex calcGlobalFifo here without all deps, 
    // but we can inspect the raw data to see if there's a "Buy" that matches.

    let runningQty = 0;
    console.log("\n--- ABNB Transaction Flow ---");
    abnbTxs.forEach(t => {
        // Simplified sign logic
        let qty = t.qty;
        // In DB, Short is usually negative qty if normalized, but raw might be positive with side='SHORT'
        // The script just dumps raw, let's interpret:
        const side = t.side || t.type; // Adjust based on schema
        if (side === 'SHORT' || side === 'SELL') qty = -Math.abs(qty);
        if (side === 'BUY' || side === 'COVER') qty = Math.abs(qty);

        runningQty += qty;
        console.log(`${new Date(t.transactionTimestamp).toISOString().slice(0, 10)} | ${side} ${qty} @ ${t.price} | Net: ${runningQty}`);
    });

    // E3: Hypothesis Check
    // If Snapshot WAS used, it injects a "Balance Forward" at snapshot date.
    // If we removed it, the Balance Forward is gone.
    // The only way PnL is +139k is if there is a phantom position closing.

    console.log("\n[Conclusion Data Point]");
    console.log("If the above flow ends near -555 (Current Short), then Realized PnL for 2026 should be 0 unless there were intra-year trades.");

}

verifyLiveState().catch(console.error);
