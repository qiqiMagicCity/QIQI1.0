
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase
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

async function main() {
    console.log("=== TSLA Full-Sequence Chronological Audit ===\n");

    const snapshot = await db.collectionGroup('transactions').get();
    const txs: any[] = [];

    // 1. Fetch and Normalize
    snapshot.docs.forEach(doc => {
        const d = doc.data();
        const sym = (d.symbol || '').toUpperCase().trim();
        // Strict match for TSLA
        if (sym !== 'TSLA') return;

        const rawQty = Number(d.qty || d.quantity || 0);
        let qty = Math.abs(rawQty);

        let action = (d.side || d.type || 'UNKNOWN').toUpperCase();

        // Determine Sign
        // SELL, SHORT -> Negative
        // BUY, COVER -> Positive
        let sign = 1;
        if (['SELL', 'SHORT'].some(k => action.includes(k))) {
            sign = -1;
        } else if (rawQty < 0) {
            // Fallback if side is weird but qty is negative
            sign = -1;
        }

        // Apply Sign
        const netQty = qty * sign;
        const ts = d.transactionTimestamp || 0;

        txs.push({
            id: doc.id,
            date: new Date(ts).toISOString().slice(0, 10),
            timeStr: new Date(ts).toISOString().slice(11, 19),
            timestamp: ts,
            action: action,
            qty: netQty,
            rawQty: rawQty
        });
    });

    // 2. Sort Strictly Chronologically
    // Primary: Timestamp, Secondary: ID (Ascending)
    txs.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
            return a.timestamp - b.timestamp;
        }
        return a.id.localeCompare(b.id);
    });

    // 3. Calculate Running Balance & Find Breakpoint
    let runningBalance = 0;
    // We want to find the LAST time the balance was >= 0 (or close to 0 within tolerance)
    // The transaction immediately AFTER that is the "Breakpoint".
    let lastNonNegativeIndex = -1;

    // We'll store the logs to print securely
    const logs: string[] = [];

    // Header
    const header = `[Date]       [Time]     [Full ID]              [Action] [Qty]      -> [Balance]`;
    logs.push(header);

    for (let i = 0; i < txs.length; i++) {
        const t = txs[i];

        // Accumulate
        runningBalance += t.qty;

        // Check if consistent with User's manual check at start
        // user said: ... 1dRZuodUCTMuKXrllTQi -> 133
        // We'll verify this in the output.

        const line = `[${t.date}] [${t.timeStr}] [${t.id}] [${t.action.padEnd(5)}] [${t.qty.toFixed(2).padStart(8)}] -> [${runningBalance.toFixed(2).padStart(8)}]`;
        logs.push(line);

        // Update last safe point
        // Using tolerance for floating point math
        if (runningBalance >= -0.001) {
            lastNonNegativeIndex = i;
        }
    }

    // 4. Output Logic
    console.log(`Total Transactions: ${txs.length}`);
    console.log(`Final Balance: ${runningBalance}`);
    console.log(`Last Safe Index (Balance >= 0): ${lastNonNegativeIndex}`);

    if (lastNonNegativeIndex === txs.length - 1) {
        console.log("Status: The account is currently balanced (>= 0). No permanent negative break found.");
    } else {
        const breakIdx = lastNonNegativeIndex + 1;
        const breakTx = txs[breakIdx];

        console.log(`\n============== BREAKPOINT DETECTED ==============`);
        console.log(`The account went negative at Transaction Log Index #${breakIdx} (0-based: ${breakIdx})`);
        console.log(`and NEVER recovered to 0 since then.`);

        console.log(`\nBreakpoint Transaction Details:`);
        console.log(`Date    : ${breakTx.date}`);
        console.log(`Time    : ${breakTx.timeStr}`);
        console.log(`Link ID : ${breakTx.id}  <-- THIS IS IT`);
        console.log(`Action  : ${breakTx.action}`);
        console.log(`Change  : ${breakTx.qty}`);

        // Print Context
        console.log(`\nPrinting Context around the Breakpoint...`);
        const start = Math.max(0, breakIdx - 5);
        const end = Math.min(txs.length, breakIdx + 10);

        for (let i = start; i < end; i++) {
            const prefix = (i === breakIdx) ? ">>> " : "    ";
            console.log(prefix + logs[i + 1]); // +1 to skip header row in logs array
        }
    }

    // Also verify the specific user sequence
    const checkId = "1dRZuodUCTMuKXrllTQi";
    const checkIdx = txs.findIndex(t => t.id === checkId);
    if (checkIdx !== -1) {
        console.log(`\nUser Verification Point:`);
        console.log(logs[checkIdx + 1]);
    } else {
        console.log(`\nCould not find User verification ID: ${checkId}`);
    }

}

main().catch(console.error);
