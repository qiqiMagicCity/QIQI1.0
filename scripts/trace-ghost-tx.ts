
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Mock types
type AssetType = 'stock' | 'option';
interface FireTx {
    symbol?: string;
    ticker?: string;
    qty?: number;
    quantity?: number;
    type?: string;
    action?: string;
    transactionTimestamp?: number | string | any;
    date?: string;
    [key: string]: any;
}

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'qiqi-1-fire'
    });
}
const db = getFirestore();

const TARGET_ID = 'gCpvRarfPZYGV84UaLu1';

async function main() {
    console.log(`[FORENSIC] Searching for Transaction ID: ${TARGET_ID} ...`);

    // 1. Scan Users
    const usersSnap = await db.collection('users').get();
    console.log(`[FORENSIC] Scanning ${usersSnap.size} users...`);

    let foundPayload: FireTx | null = null;
    let foundUid: string | null = null;
    let foundCol: string | null = null;

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;

        // Check transactions
        const txRef = db.collection('users').doc(uid).collection('transactions').doc(TARGET_ID);
        const txSnap = await txRef.get();
        if (txSnap.exists) {
            foundPayload = txSnap.data() as FireTx;
            foundUid = uid;
            foundCol = 'transactions';
            break;
        }

        // Check trades
        const trRef = db.collection('users').doc(uid).collection('trades').doc(TARGET_ID);
        const trSnap = await trRef.get();
        if (trSnap.exists) {
            foundPayload = trSnap.data() as FireTx;
            foundUid = uid;
            foundCol = 'trades';
            break;
        }
    }

    if (!foundPayload || !foundUid || !foundCol) {
        console.error(`[FORENSIC] ❌ Transaction ${TARGET_ID} NOT FOUND in any user's 'transactions' or 'trades'.`);
        process.exit(1);
    }

    console.log(`[FORENSIC] ✅ FOUND Transaction!`);
    console.log(`[FORENSIC] User UID: ${foundUid}`);
    console.log(`[FORENSIC] Collection: ${foundCol}`);
    console.log(`[FORENSIC] Raw Data:`, JSON.stringify(foundPayload, null, 2));

    // 2. Fetch Context (Other AAPL transactions for this user)
    const symbolRaw = foundPayload.symbol || foundPayload.ticker || 'AAPL';
    console.log(`[FORENSIC] Searching for sibling transactions with symbol similar to: ${symbolRaw}`);

    const allTxSnap = await db.collection('users').doc(foundUid).collection(foundCol).get();

    const siblings: any[] = [];
    allTxSnap.forEach(d => {
        const dData = d.data() as FireTx;
        const s = dData.symbol || dData.ticker || '';
        if (s && s.toUpperCase().includes('AAPL')) {
            siblings.push({ id: d.id, ...dData });
        }
    });

    console.log(`[FORENSIC] Found ${siblings.length} sibling AAPL transactions.`);

    let goodRecord: any = null;
    const badRecord: any = { id: TARGET_ID, ...foundPayload };

    siblings.forEach(sib => {
        console.log(`--- Candidate ID: ${sib.id} ---`);
        console.log(`    Symbol: ${sib.symbol} (len=${sib.symbol?.length})`);
        console.log(`    Qty: ${sib.qty || sib.quantity} (type=${typeof (sib.qty || sib.quantity)})`);

        if (sib.id !== TARGET_ID && Math.abs((sib.qty || sib.quantity) - 50) < 0.01) {
            goodRecord = sib;
            console.log("    >>> MATCHES 'GOOD' PROFILE (Qty ~50)");
        }
        if (sib.id === TARGET_ID) {
            console.log("    >>> TARGET (BAD RECORD)");
        }
    });

    if (goodRecord && badRecord) {
        console.log("\n========================================================");
        console.log("🔥 FORENSIC CLASH: GOOD (50) vs BAD (500)");
        console.log("========================================================");

        const keys = Array.from(new Set([...Object.keys(goodRecord), ...Object.keys(badRecord)])).sort();

        keys.forEach(k => {
            const vGoods = goodRecord[k];
            const vBad = badRecord[k];
            const match = JSON.stringify(vGoods) === JSON.stringify(vBad) ? "✅" : "❌";

            // Highlight specific fields
            if (['symbol', 'qty', 'quantity', 'transactionTimestamp', 'date', 'type', 'assetType', 'portfolioId'].includes(k)) {
                console.log(`\n[${k}]`);
                console.log(`   GOOD: ${JSON.stringify(vGoods)} \t(Type: ${typeof vGoods})`);
                console.log(`   BAD:  ${JSON.stringify(vBad)} \t(Type: ${typeof vBad})`);
                if (k === 'symbol' && typeof vGoods === 'string' && typeof vBad === 'string') {
                    console.log(`   Bytes Good: ${Buffer.from(vGoods).toString('hex')}`);
                    console.log(`   Bytes Bad:  ${Buffer.from(vBad).toString('hex')}`);
                }
            }
        });
        console.log("========================================================");
    } else {
        console.log("\n[FORENSIC] Could not locate 'Good' record (Qty 50) for comparison.");
        console.log("Dumping Bad Record raw:", JSON.stringify(badRecord, null, 2));
    }

    // 3. Simulated Rules Check
    console.log(`\n[FORENSIC] Checking Aggregation Compatibility...`);
    const target = foundPayload;

    // Check Date
    let ts: number | null = null;
    if (typeof target.transactionTimestamp === 'number') ts = target.transactionTimestamp;
    else if (target.transactionTimestamp && typeof target.transactionTimestamp.toMillis === 'function') ts = target.transactionTimestamp.toMillis();
    else if (typeof target.transactionTimestamp === 'string') ts = new Date(target.transactionTimestamp).getTime();

    if (ts) {
        const dateStr = new Date(ts).toISOString().split('T')[0];
        console.log(`[CHECK] Target Date (UTC ISO): ${dateStr}`);
        console.log(`[CHECK] Target Timestamp: ${ts}`);

        const currentYear = new Date().getFullYear();
        if (dateStr.startsWith(String(currentYear + 1))) {
            console.warn(`[WARNING] Target is in ${currentYear + 1}. If 'Analysis Year' is ${currentYear}, it WILL BE HIDDEN.`);
        }
    } else {
        console.warn(`[WARNING] Could not parse timestamp from target.`);
    }

    // Check Symbol Cleanliness
    const targetSym = (target.symbol || target.ticker || '').replace(/\s+/g, '').toUpperCase();
    console.log(`[CHECK] Target Normalized Symbol: '${targetSym}'`);

    // Check if any sibling has different symbol
    siblings.forEach(sib => {
        const s = (sib.symbol || sib.ticker || '').replace(/\s+/g, '').toUpperCase();
        if (s !== targetSym) {
            console.warn(`[WARNING] Sibling ${sib.id} has different symbol: '${s}' vs '${targetSym}'.`);
        }
    });
}

main().catch(err => console.error(err));
