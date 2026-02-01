
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: "studio-9804216494-c2b75" });
}
const db = getFirestore();

// --- Helpers ---
const SPLIT_CFG = [{ symbol: 'TSLA', date: '2022-08-25', ratio: 3 }];

function getSplitFactor(ts: number) {
    const d = new Date(ts).toISOString().slice(0, 10);
    return d < '2022-08-25' ? 3 : 1;
}

async function main() {
    console.log("=== TSLA Deep Dive: FIFO Matcher ===\n");

    const snap = await db.collectionGroup('transactions').get();
    const txs: any[] = [];

    // 1. Collect Valid TSLA Tx
    snap.docs.forEach(d => {
        const data = d.data();
        const sym = (data.symbol || '').toUpperCase();
        if (sym === 'TSLA' || sym.startsWith('TSLA ')) {
            const rawQty = Number(data.qty || data.quantity || 0);
            let qty = Math.abs(rawQty);
            let side = (data.type || data.side || '').toUpperCase();

            // Normalize Side
            if (['SELL', 'SHORT'].some(s => side.includes(s)) || rawQty < 0) {
                qty = -qty; // Sell is negative
                side = 'SELL';
            } else {
                side = 'BUY';
            }

            // Normalize Timestamp
            const ts = data.transactionTimestamp || 0;

            txs.push({
                id: d.id,
                date: new Date(ts).toISOString().slice(0, 10),
                ts,
                qty, // raw quantity
                side,
                raw: data
            });
        }
    });

    // 2. Sort Chronologically
    // Use ID as tie-breaker for deterministic sorting
    txs.sort((a, b) => (a.ts - b.ts) || a.id.localeCompare(b.id));

    // 3. FIFO Matching Engine
    // We maintain a "Long Inventory" of { qty, id, date }
    // When a SELL occurs, we consume from this inventory.
    // If inventory is empty, that SELL is "Unmatched" (The Culprit).

    let inventory: any[] = [];
    let unmatchedSells: any[] = [];
    let unmatchedBuys: any[] = []; // Should technically be current holdings

    console.log(`Processing ${txs.length} TSLA transactions...`);

    for (const tx of txs) {
        let splitFactor = getSplitFactor(tx.ts);

        // Adjust for split "on the fly" for the ledger matching?
        // Actually, easiest is to convert EVERYTHING to "Post-Split Basis" (Adjusted Qty)
        // So a pre-2022 buy of 1 is treated as 3.

        let adjQty = tx.qty * splitFactor;

        if (adjQty > 0) {
            // BUY: Add to inventory
            inventory.push({ ...tx, adjQty, remaining: adjQty });
        } else {
            // SELL: Consume inventory
            let qtyToClose = Math.abs(adjQty);

            while (qtyToClose > 0.0001 && inventory.length > 0) {
                const openPos = inventory[0];
                const matched = Math.min(qtyToClose, openPos.remaining);

                openPos.remaining -= matched;
                qtyToClose -= matched;

                if (openPos.remaining < 0.0001) {
                    inventory.shift(); // Fully closed
                }
            }

            // If still have qtyToClose, this SELL is unmatched/naked
            if (qtyToClose > 0.0001) {
                unmatchedSells.push({ ...tx, gapQty: -qtyToClose });
            }
        }
    }

    // 4. Report Results
    console.log(`\n============================================================`);
    console.log(` UNMATCHED SELL TRANSACTIONS (The "Holes" in the data)`);
    console.log(` These are Sell/Short orders that had no prior Buy/Cover.`);
    console.log(`============================================================`);
    console.log(`Date       | Gap Qty    | Full Tx ID           | Note`);
    console.log(`-----------|------------|----------------------|-----------------`);

    let totalGap = 0;
    unmatchedSells.forEach(item => {
        totalGap += item.gapQty;
        const dateStr = item.date;
        const qtyStr = item.gapQty.toFixed(2).padStart(10);
        console.log(`${dateStr} | ${qtyStr} | ${item.id.padEnd(20)} | Balance Impact`);
    });

    console.log(`\nTotal Missing Shares (Sum of Gaps): ${totalGap.toFixed(2)}`);
    console.log(`Current Inventory (Unsold Buys): ${inventory.reduce((a, b) => a + b.remaining, 0).toFixed(2)}`);
    console.log(`Net Ledger Check: ${(inventory.reduce((a, b) => a + b.remaining, 0) + totalGap).toFixed(2)} (=? Total Gap)`);

    // 5. Specific ID Check
    console.log(`\n============================================================`);
    console.log(` USER QUERY: Specific ID Analysis`);
    console.log(`============================================================`);
    const qIds = ['xny1EveLevsHVtngIJkV', 'xTpAealwr8bYSW4pMAVQ'];
    const qTxs = txs.filter(t => qIds.includes(t.id));
    qTxs.forEach(t => {
        console.log(`ID: ${t.id}, Date: ${t.date}, Time: ${new Date(t.ts).toISOString().slice(11, 19)}, Side: ${t.side}, Qty: ${t.qty}`);
    });

}

main().catch(console.error);
