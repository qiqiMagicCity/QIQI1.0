
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
    { symbol: 'GOOGL', effectiveDate: '2022-07-18', splitRatio: 20 },
    { symbol: 'AMZN', effectiveDate: '2022-06-06', splitRatio: 20 },
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

// Ensure the logs are written and visible
console.log("Starting Debug Script...");

async function main() {
    console.log("=== Multi-Symbol Audit (TSLA, NVDA, AMZN) ===");

    // We target all of them
    const targetSymbols = ['TSLA', 'NVDA', 'AMZN'];

    // Scan all transactions (using collection group is heavy but robust)
    const transactionsSnap = await db.collectionGroup('transactions').get();

    const relevantTxs: any[] = [];
    transactionsSnap.docs.forEach(doc => {
        const data = doc.data();
        const sym = (data.symbol || '').toUpperCase();
        // Check if symbol matches any of our targets
        if (targetSymbols.some(t => sym === t || sym.startsWith(t + ' '))) {
            relevantTxs.push({ ...data, id: doc.id, _docPath: doc.ref.path });
        }
    });

    let logBuffer = "";
    const log = (msg: string) => { console.log(msg); logBuffer += msg + "\n"; };

    log(`Total Transacitons Scanned: ${transactionsSnap.size}`);
    log(`Relevant Transactions Found: ${relevantTxs.length}`);

    // Group by Symbol
    const groups = new Map<string, any[]>();
    relevantTxs.forEach(t => {
        const normalized = { ...normalizeFireTx(t), _docPath: t._docPath };
        const sym = normalized.symbol;
        if (!groups.has(sym)) groups.set(sym, []);
        groups.get(sym)!.push(normalized);
    });

    for (const target of targetSymbols) {
        log(`\n\n>>> AUDIT FOR SYMBOL: ${target} <<<`);
        const group = groups.get(target) || [];

        if (group.length === 0) {
            log(`No transactions found for ${target}.`);
            continue;
        }

        // Sort by time
        group.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

        log(`------------------------------------------------------------------------------------------------------------------------`);
        log(`| Date       | ID                   | Type   | Side | Qty  | AdjQty | Mult | Split | RunQty (Adj) | Path`);
        log(`------------------------------------------------------------------------------------------------------------------------`);

        let stockNet = 0;
        let optionNet = 0;
        let runningStock = 0;

        group.forEach(t => {
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

            // Extract simple path (last few chars)
            const pathSuffix = t._docPath.split('/').slice(-2).join('/');

            log(`| ${t.date} | ${t.id.padEnd(20)} | ${typeStr} | ${sideStr} | ${qtyStr} | ${adjQtyStr} | ${splitStr} | ${splitStr} | ${runStr} | ...${pathSuffix}`);
        });

        log(`------------------------------------------------------------------------------------------------------------------------`);
        log(`[Calculated] Stock Net (Adjusted): ${stockNet}`);
        log(`[Calculated] Option Net: ${optionNet} (Contracts)`);

        // Check Hidden Flag for this symbol in the FIRST user found (assuming single user context usually)
        if (group.length > 0) {
            const samplePath = group[0]._docPath;
            const parts = samplePath.split('/');
            if (parts[0] === 'users' && parts.length >= 2) {
                const uid = parts[1];
                const holdingRef = db.collection('users').doc(uid).collection('holdings').doc(target);
                const holdingSnap = await holdingRef.get();
                if (holdingSnap.exists) {
                    const hData = holdingSnap.data();
                    log(`\n[Firestore Doc] users/${uid}/holdings/${target}:`);
                    log(` - NetQty: ${hData?.netQty}`);
                    log(` - AvgCost: ${hData?.avgCost}`);
                    log(` - IsHidden: ${hData?.isHidden}`);
                    log(` - ManualMarkPrice: ${hData?.manualMarkPrice}`);
                } else {
                    log(`\n[Firestore Doc] users/${uid}/holdings/${target} DOES NOT EXIST.`);
                }
            }
        }
    }

    const fs = require('fs');
    fs.writeFileSync('./audit_mismatch_result.txt', logBuffer, 'utf8');
    log("\nAudit saved to ./audit_mismatch_result.txt");
}

main().catch(console.error);
