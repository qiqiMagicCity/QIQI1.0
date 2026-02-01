
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    try {
        admin.initializeApp({
            projectId: "studio-9804216494-c2b75"
        });
    } catch (e) {
        console.error("Firebase failing initialization.");
        process.exit(1);
    }
}

const db = getFirestore();

// --- Helpers ---
// TSLA Split: 3-for-1 on 2022-08-25
const SPLIT_DATE = '2022-08-25';
const SPLIT_RATIO = 3;

function getSplitAdjustedQty(tx: any): number {
    let q = tx.qty;
    // Normalize side
    const side = (tx.side || tx.type || '').toUpperCase();
    if (side.includes('SELL') || side.includes('SHORT')) {
        q = -Math.abs(q);
    } else {
        q = Math.abs(q);
    }

    // Split adjust
    const date = new Date(tx.transactionTimestamp).toISOString().slice(0, 10);
    if (date < SPLIT_DATE) {
        q = q * SPLIT_RATIO;
    }
    return q;
}

async function main() {
    console.log("=== TSLA Precision Matcher ===\n");

    const snap = await db.collectionGroup('transactions').get();
    const txs: any[] = [];

    // 1. Load TSLA
    snap.docs.forEach(doc => {
        const d = doc.data();
        const sym = (d.symbol || '').toUpperCase();
        if (sym === 'TSLA') {
            txs.push({
                id: doc.id,
                transactionTimestamp: d.transactionTimestamp || 0,
                qty: Number(d.qty || d.quantity || 0),
                side: d.side || d.type,
                raw: d
            });
        }
    });

    // Sort by Time then ID
    txs.sort((a, b) => (a.transactionTimestamp - b.transactionTimestamp) || a.id.localeCompare(b.id));

    console.log(`Total TSLA Transactions: ${txs.length}`);

    // 2. Analyze the Specific User Dispute Pair (Feb 15)
    console.log(`\n[I. User Dispute Check: Feb 15, 2024]`);
    const disputeIds = ['FY6IO0417gXTSPWqW9Hi', 'vxaSIRD3kLtJJlWCLjhp'];
    const disputeTxs = txs.filter(t => disputeIds.includes(t.id));

    // Sort these two specifically
    disputeTxs.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    if (disputeTxs.length === 2) {
        const t1 = disputeTxs[0];
        const t2 = disputeTxs[1];

        console.log(`Tx 1: ${t1.id} | ${new Date(t1.transactionTimestamp).toISOString()} | ${t1.side} | ${t1.qty}`);
        console.log(`Tx 2: ${t2.id} | ${new Date(t2.transactionTimestamp).toISOString()} | ${t2.side} | ${t2.qty}`);

        const sum = getSplitAdjustedQty(t1) + getSplitAdjustedQty(t2);
        console.log(`> Net Impact of Pair: ${sum}`);

        if (Math.abs(sum) < 0.001) {
            console.log(`> CONCLUSION: You are CORRECT. These cancel out perfectly. They are NOT the cause of the -273 discrepancy.`);
        } else {
            console.log(`> CONCLUSION: Mismatch found.`);
        }
    } else {
        console.log(`> Could not find both transactions in the database.`);
    }

    // 3. Elimination Algorithm to find THE REAL REMAINING CULPRITS
    // Strategy: We will maintain a list of "Open Chunks".
    // Positive Chunks (Longs) and Negative Chunks (Shorts).
    // Every time we get a transaction, we try to "eat" existing chunks of the OPPOSITE sign.
    // Whatever is left at the end is the -273 discrepancies.

    let residuals: any[] = [];

    for (const t of txs) {
        const q = getSplitAdjustedQty(t);
        const isPos = q > 0;

        let remaining = Math.abs(q);

        // Try to match with existing residuals of opposite usage
        // Iterate backwards or forwards? 
        // FIFO matching implies we eat the OLDEST opposing residual first.

        // Filter residuals that are opposite sign
        // We need to modify the residuals array in place, so let's iterate carefully.

        // Find indices of clean opposites
        for (let i = 0; i < residuals.length; i++) {
            if (remaining < 0.0001) break;

            const res = residuals[i];
            const resIsPos = res.qty > 0;

            if (resIsPos !== isPos) {
                // Opposite found! Match.
                const matchAmount = Math.min(remaining, Math.abs(res.qty));

                // Reduce residual
                if (res.qty > 0) res.qty -= matchAmount;
                else res.qty += matchAmount; // reducing a negative towards zero

                // Reduce current
                remaining -= matchAmount;

                // If residual is explicitly 0, mark for deletion (we'll clean after)
            }
        }

        // Clean up empty residuals
        residuals = residuals.filter(r => Math.abs(r.qty) > 0.0001);

        // If current transaction still has remainder, add it as a new residual
        if (remaining > 0.0001) {
            residuals.push({
                ...t,
                qty: isPos ? remaining : -remaining,
                originalId: t.id,
                date: new Date(t.transactionTimestamp).toISOString().slice(0, 10)
            });
        }
    }

    console.log(`\n[II. The Real Residuals]`);
    console.log(`After matching ALL buys against ALL sells (FIFO), these are the transactions that remain stuck in the ledger.`);
    console.log(`Summing these should equal exactly -273.`);
    console.log(`\nDate       | Residual   | Original Side | ID`);
    console.log(`-----------|------------|---------------|----------------------`);

    let totalRes = 0;
    residuals.forEach(r => {
        totalRes += r.qty;
        console.log(`${r.date} | ${r.qty.toFixed(2).padStart(10)} | ${(r.side || '').padEnd(13)} | ${r.id}`);
    });

    console.log(`\nTotal Discrepancy: ${totalRes.toFixed(2)}`);
}

main().catch(console.error);
