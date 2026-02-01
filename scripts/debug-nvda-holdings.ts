
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// 1. Initialize Firebase
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

// Connection Check
db.listCollections().then(cols => {
    console.log("Connected to Project. Collections:", cols.map(c => c.id).join(", "));
}).catch(err => {
    console.error("Failed to list collections. Check permissions:", err.message);
});

// Helper to mimic internal normalizer
function getPath(obj: any, path: string) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function pickFirst<T = any>(obj: any, keys: string[]): T | undefined {
    for (const k of keys) {
        const v = k.includes('.') ? getPath(obj, k) : obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v as T;
    }
    return undefined;
}

function normalizeFireTx(raw: any): any {
    const symbolRaw = pickFirst<string>(raw, ['symbol', 'ticker', 'underlying', 'symbolRoot', 'optionDetails.symbol']);
    const symbolClean = symbolRaw != null ? String(symbolRaw).trim() : '';
    const symbolUpper = symbolClean.toUpperCase();

    const atCand = (pickFirst<any>(raw, ['assetType', 'securityType', 'instrumentType']) ?? '').toString().toLowerCase();
    let assetType = atCand.includes('option') ? 'option' : 'stock';

    if (assetType === 'stock') {
        const tText = String(raw.type ?? '').toLowerCase();
        if (tText === 'option' || tText.includes('option')) assetType = 'option';
    }

    const qtySrc = pickFirst<any>(raw, ['qty', 'quantity', 'shares', 'contracts', 'size']);
    let qty = Number(qtySrc);
    if (isNaN(qty)) qty = 0;

    // Fix side/qty sign logic (matches use-user-transactions.ts)
    const primaryRaw = pickFirst<any>(raw, ['type', 'action', 'side']);
    const primary = primaryRaw != null ? String(primaryRaw).trim().toUpperCase() : '';
    const bag = [raw.type, raw.action, raw.side].filter(Boolean).map(String).join('|').toLowerCase();

    let side = 'BUY';
    if (primary === 'SHORT' || primary === 'SELL' || /short\s*sell/.test(bag) || /sell/.test(bag)) {
        side = 'SELL';
    } else if (primary === 'COVER' || /cover/.test(bag)) {
        side = 'BUY';
    } else if (qty < 0) {
        // Fallback: if qty is negative, assume sell if side not explicit
        side = 'SELL';
    }

    if (side === 'BUY') qty = Math.abs(qty);
    if (side === 'SELL') qty = -Math.abs(qty);

    const multiplier = typeof raw.multiplier === 'number' ? raw.multiplier : (assetType === 'option' ? 100 : 1);
    const ts = raw.transactionTimestamp || 0;

    return {
        id: raw.id,
        symbol: symbolUpper,
        assetType,
        qty,
        multiplier,
        transactionTimestamp: ts,
        date: new Date(ts).toISOString().slice(0, 10),
        raw
    };
}

const DEFAULT_STOCK_SPLITS = [
    { symbol: 'NFLX', effectiveDate: '2025-11-17', splitRatio: 10 },
    { symbol: 'NVDA', effectiveDate: '2024-06-07', splitRatio: 10 },
    { symbol: 'TSLA', effectiveDate: '2022-08-25', splitRatio: 3 },
    { symbol: 'NFLX', effectiveDate: '2015-07-15', splitRatio: 7 },
];

function normalizeSymbolForGrouping(s: string): string {
    return (s ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}

function getCumulativeSplitFactor(symbolRaw: string, txTimestamp: number, activeSplits: any[] = DEFAULT_STOCK_SPLITS): number {
    if (!symbolRaw || !Number.isFinite(txTimestamp)) return 1;
    const normalizedSymbol = normalizeSymbolForGrouping(symbolRaw);
    const txDay = new Date(txTimestamp).toISOString().slice(0, 10);

    let factor = 1;
    for (const ev of activeSplits) {
        if (normalizeSymbolForGrouping(ev.symbol) !== normalizedSymbol) continue;
        if (txDay < ev.effectiveDate && ev.splitRatio > 0) {
            factor *= ev.splitRatio;
        }
    }
    return factor;
}

async function main() {
    console.log("=== NVDA Audit Script (With Scoped Splits) ===");

    // Scan all transactions
    const transactionsSnap = await db.collectionGroup('transactions').get();

    const relevantTxs: any[] = [];
    transactionsSnap.docs.forEach(doc => {
        const data = doc.data();
        const sym = (data.symbol || '').toUpperCase();
        if (sym === 'NVDA' || sym.startsWith('NVDA ')) {
            relevantTxs.push({ ...data, id: doc.id, _docPath: doc.ref.path });
        }
    });

    // Prepare Output Buffer
    let logBuffer = "";
    const log = (msg: string) => { console.log(msg); logBuffer += msg + "\n"; };

    log(`Scanning ${transactionsSnap.size} total docs. Found ${relevantTxs.length} NVDA records.`);

    if (relevantTxs.length > 0) {
        log(`------------------------------------------------------------------------------------------------------------------------`);
        log(`| Date       | ID                   | Type   | Side | Qty  | AdjQty | Mult | Split | RunQty (Adj) | Path`);
        log(`------------------------------------------------------------------------------------------------------------------------`);

        const normalized = relevantTxs.map(t => ({ ...normalizeFireTx(t), _docPath: t._docPath }));
        normalized.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

        let stockNet = 0;
        let optionNet = 0;
        let runningStock = 0;

        normalized.forEach(t => {
            const isOption = t.assetType === 'option';

            // Apply Split Logic
            let adjQty = t.qty;
            let splitFactor = 1;

            if (!isOption) {
                splitFactor = getCumulativeSplitFactor(t.symbol, t.transactionTimestamp);
                if (splitFactor !== 1) {
                    adjQty = t.qty * splitFactor;
                }
            }

            if (isOption) {
                optionNet += t.qty;
            } else {
                stockNet += adjQty;
                runningStock += adjQty;
            }

            // Formatting
            const typeStr = t.assetType.padEnd(6);
            const sideStr = (t.raw.side || (t.qty > 0 ? 'BUY' : 'SELL')).padEnd(4);
            const qtyStr = String(t.qty).padEnd(6);
            const adjQtyStr = String(adjQty).padEnd(8);
            const splitStr = String(splitFactor).padEnd(5);
            const runStr = String(runningStock).padEnd(10);

            log(`| ${t.date} | ${t.id.padEnd(20)} | ${typeStr} | ${sideStr} | ${qtyStr} | ${adjQtyStr} | ${splitStr} | ${splitStr} | ${runStr} | ...${t._docPath.slice(-20)}`);
        });

        log(`------------------------------------------------------------------------------------------------------------------------`);
        log(`[Calculated] Stock Net (Adjusted): ${stockNet}`);
        log(`[Calculated] Option Net: ${optionNet} (Contracts)`);
    } else {
        log("No NVDA transactions found.");
    }

    // Write local file
    const fs = require('fs');
    fs.writeFileSync('./audit_nvda_result.txt', logBuffer, 'utf8');

    // [NEW] Check for Hidden Flag in Firestore
    if (relevantTxs.length > 0) {
        console.log("\nChecking for Hidden Flags in 'holdings' collection...");
        // relevantTxs has _docPath: users/{uid}/transactions/{txId}
        // Extract uid
        const samplePath = relevantTxs[0]._docPath;
        // e.g. users/USER_ID/transactions/TX_ID
        const parts = samplePath.split('/');
        if (parts[0] === 'users' && parts.length >= 2) {
            const uid = parts[1];
            console.log(`Target UID: ${uid}`);
            const holdingRef = db.collection('users').doc(uid).collection('holdings').doc('NVDA');
            const holdingSnap = await holdingRef.get();
            if (holdingSnap.exists) {
                console.log(`Found 'holdings/NVDA' doc:`, holdingSnap.data());
                if (holdingSnap.data()!.isHidden) {
                    console.log(">>> WARNING: NVDA IS EXPLICITLY HIDDEN! <<<");
                }
            } else {
                console.log("No 'holdings/NVDA' doc found (implies not hidden).");
            }
        }
    }
}

main().catch(console.error);
