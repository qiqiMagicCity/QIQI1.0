
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: "studio-9804216494-c2b75" });
}
const db = getFirestore();

async function main() {
    console.log("=== TSLA Chronological Ledger Audit ===\n");

    const snap = await db.collectionGroup('transactions').get();
    let txs: any[] = [];

    // 1. Fetch & Normalize
    snap.docs.forEach(d => {
        const data = d.data();
        const sym = (data.symbol || '').toUpperCase();
        if (sym === 'TSLA') {
            let qty = Number(data.qty || data.quantity || 0);
            let side = (data.side || data.type || '').toUpperCase();

            // Normalize Side & Sign
            // If side is SELL/SHORT, qty should be negative for balance calc
            // If side is BUY/COVER, qty should be positive
            const isSell = ['SELL', 'SHORT'].some(s => side.includes(s));
            const isBuy = ['BUY', 'COVER'].some(s => side.includes(s));

            // Safety fallback if side is ambiguous but qty is signed
            if (!isSell && !isBuy) {
                if (qty < 0) side = 'SELL';
                else side = 'BUY';
            }

            if (isSell) qty = -Math.abs(qty);
            else qty = Math.abs(qty);

            // TSLA Split Adjust (3:1 on 2022-08-25)
            // We convert everything to TODAY'S shares standard
            const ts = data.transactionTimestamp || 0;
            const date = new Date(ts).toISOString().slice(0, 10);
            if (date < '2022-08-25') {
                qty = qty * 3;
            }

            txs.push({
                id: d.id,
                date,
                time: new Date(ts).toISOString().slice(11, 19),
                ts,
                qty,         // Net change to balance
                origSide: side,
                rawQty: Number(data.qty || 0)
            });
        }
    });

    // 2. Sort Chronologically (Time then ID)
    txs.sort((a, b) => (a.ts - b.ts) || a.id.localeCompare(b.id));

    console.log(`Loaded ${txs.length} TSLA transactions.`);
    console.log(`Logic: Chronological Running Balance. Goal: Find 'Point of No Return'.\n`);

    // 3. Process Ledger
    let balance = 0;
    let lastZeroIndex = -1; // Index of the last transaction where balance was >= -0.01 (tolerance)

    // We will store the output lines to print them selectively
    const ledgerLines: string[] = [];

    for (let i = 0; i < txs.length; i++) {
        const t = txs[i];

        // Update Balance
        balance += t.qty;

        // Log line
        // Format: [Index] Date Time | Side | Change | Balance | ID
        const line = `[${i + 1}] ${t.date} ${t.time} | ${t.origSide.padEnd(5)} | ${t.qty.toFixed(2).padStart(10)} | ${balance.toFixed(2).padStart(10)} | ${t.id}`;
        ledgerLines.push(line);

        // Check for Zero/Positive Reset
        // We look for the last time the balance was "Safe" (>= 0)
        // Using slight epsilon for float math
        if (balance >= -0.01) {
            lastZeroIndex = i;
        }
    }

    // 4. Output the User's Verified Examples (First 10 lines)
    console.log(`--- [Verification] First 10 Transactions ---`);
    for (let i = 0; i < Math.min(10, ledgerLines.length); i++) {
        console.log(ledgerLines[i]);
    }
    console.log(`...\n`);

    // 5. Locate the Breakpoint
    console.log(`--- [Analysis] Identifying the Breakpoint ---`);
    console.log(`Final Balance: ${balance.toFixed(2)}`);
    console.log(`Last time Balance was >= 0: Transaction #${lastZeroIndex + 1} (Index ${lastZeroIndex})`);

    if (lastZeroIndex === txs.length - 1) {
        console.log(`Result: The balance is currently exactly 0 or positive. No discrepancy found?`);
    } else {
        const breakIndex = lastZeroIndex + 1;
        const breakTx = txs[breakIndex];
        console.log(`\n>>> THE BREAKPOINT IS HERE: Transaction #${breakIndex + 1} <<<`);
        console.log(`At this moment, the balance went negative and NEVER returned to zero.`);

        // Print context: 3 lines before, then the Rest (or next 20)
        const start = Math.max(0, breakIndex - 3);
        const end = Math.min(txs.length, breakIndex + 20); // Show next 20 lines

        console.log(`\nContext Ledger:`);
        for (let i = start; i < end; i++) {
            let marker = "   ";
            if (i === breakIndex) marker = ">>>";
            console.log(`${marker} ${ledgerLines[i]}`);
        }

        if (end < txs.length) {
            console.log(`... (${txs.length - end} more transactions remaining in negative territory) ...`);
        }
    }
}

main().catch(console.error);
