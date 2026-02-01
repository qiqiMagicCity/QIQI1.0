
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

// --- Helpers ---

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

    // Fix side/qty sign logic
    const primaryRaw = pickFirst<any>(raw, ['type', 'action', 'side']);
    const primary = primaryRaw != null ? String(primaryRaw).trim().toUpperCase() : '';
    const bag = [raw.type, raw.action, raw.side].filter(Boolean).map(String).join('|').toLowerCase();

    let side = 'BUY';
    if (primary === 'SHORT' || primary === 'SELL' || /short\s*sell/.test(bag) || /sell/.test(bag)) {
        side = 'SELL';
    } else if (primary === 'COVER' || /cover/.test(bag)) {
        side = 'BUY';
    } else if (qty < 0) {
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
        qty, // signed
        rawQty: Math.abs(qty),
        side,
        multiplier,
        transactionTimestamp: ts,
        date: new Date(ts).toISOString().slice(0, 10),
        raw
    };
}

// --- Main Script ---

async function main() {
    console.log("=== Ledger Audit & Reverse Calc Report ===\n");

    const targetIds = ['x9cwFIG1O07OHQrxlcwf']; // The Ghost Share ID
    const targetSymbols = ['TSLA', 'NVDA', 'AMZN'];
    const userExpectations: Record<string, number> = {
        'TSLA': 0,
        'NVDA': 377,
        'AMZN': 300
    };

    // 1. Fetch all transactions
    const transactionsSnap = await db.collectionGroup('transactions').get();
    const relevantTxs: any[] = [];
    let ghostTxDoc: any = null;

    transactionsSnap.docs.forEach(doc => {
        const data = doc.data();
        const sym = (data.symbol || '').toUpperCase();

        // Check for Ghost ID
        if (doc.id === targetIds[0]) {
            ghostTxDoc = { ...data, id: doc.id, _docPath: doc.ref.path };
        }

        // Filter by Symbols
        if (targetSymbols.some(t => sym === t || sym.startsWith(t + ' '))) {
            relevantTxs.push({ ...data, id: doc.id, _docPath: doc.ref.path });
        }
    });

    // --- Task 1: The Ghost Share ---
    console.log(`\n------------------------------------------------------------`);
    console.log(`[Task 1] NVDA Ghost Share Analysis (ID: ${targetIds[0]})`);
    console.log(`------------------------------------------------------------`);
    if (ghostTxDoc) {
        console.log(JSON.stringify(ghostTxDoc, null, 2));
    } else {
        console.log(">> Transaction NOT FOUND in database scan.");
    }

    // --- Processing for Task 2 & 3 ---
    const groups = new Map<string, any[]>();
    relevantTxs.forEach(t => {
        const normalized = normalizeFireTx(t);
        // Only care about STOCK for this ledger analysis as per request context
        if (normalized.assetType !== 'option') {
            const sym = normalized.symbol;
            if (!groups.has(sym)) groups.set(sym, []);
            groups.get(sym)!.push({ ...normalized, _docPath: t._docPath });
        }
    });

    for (const target of targetSymbols) {
        console.log(`\n\n============================================================`);
        console.log(` AUDIT REPORT FOR: ${target}`);
        console.log(`============================================================`);

        const group = groups.get(target) || [];
        group.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

        let runningBalance = 0;
        let firstNegativeDate: string | null = null;
        let firstNegativeId: string | null = null;
        let hasPrintedHeader = false;

        console.log(`\n[Task 2] Running Ledger (Adjusted for Splits)`);
        console.log(`Date       | Action | Side  | AdjQty     | Balance    | ID                   | Note`);
        console.log(`-----------|--------|-------|------------|------------|----------------------|-----`);

        if (group.length === 0) {
            console.log("No transactions found.");
        }

        for (const t of group) {
            // Calculate Adjusted Qty
            const splitFactor = getCumulativeSplitFactor(t.symbol, t.transactionTimestamp);
            const adjQty = t.qty * splitFactor; // signed

            const prevBalance = runningBalance;
            runningBalance += adjQty;

            // Check for negative crossover
            let note = "";
            const isNegative = runningBalance < -0.0001;
            const wasNegative = prevBalance < -0.0001;

            if (isNegative && !wasNegative && !firstNegativeDate) {
                firstNegativeDate = t.date;
                firstNegativeId = t.id;
                note = "<< FIRST NEGATIVE";
            }

            // Formatting
            const dateStr = t.date;
            const actionStr = (t.raw.type || '').slice(0, 6).padEnd(7);
            const sideStr = t.side.padEnd(5);
            const qtyStr = adjQty.toFixed(2).padStart(10);
            const balStr = runningBalance.toFixed(2).padStart(10);
            const idStr = t.id.padEnd(20);

            console.log(`${dateStr} | ${actionStr}| ${sideStr} | ${qtyStr} | ${balStr} | ${idStr} | ${note}`);
        }

        // --- Task 3: Reverse Calculation ---
        console.log(`\n[Task 3] Reverse Calculation (Target: ${userExpectations[target]})`);
        console.log(`------------------------------------------------------------`);

        const calculated = runningBalance;
        const expected = userExpectations[target];
        const diff = expected - calculated;

        console.log(`System Calculated Final: ${calculated}`);
        console.log(`User Expected Actual : ${expected}`);
        console.log(`Difference (Missing) : ${diff.toFixed(5)}`);

        let suggestion = "";
        if (Math.abs(diff) < 0.0001) {
            suggestion = ">> Match! No action needed.";
        } else if (diff > 0) {
            suggestion = `>> MISSING ASSETS. Suggest inserting 'Initial Balance' or 'BUY': +${diff.toFixed(5)}`;
        } else {
            suggestion = `>> EXCESS ASSETS. Suggest inserting 'Initial Balance (Negative)' or 'SELL': ${diff.toFixed(5)}`;
        }
        console.log(suggestion);

        if (firstNegativeDate) {
            console.log(`\n>> Root Cause Hint: Balance first went negative on ${firstNegativeDate} (TxID: ${firstNegativeId}).`);
            console.log(`   Likely missing a BUY/Transfer-In existing BEFORE this date.`);
        }
    }
}

main().catch(console.error);
