
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
    { symbol: 'TSLA', effectiveDate: '2022-08-25', splitRatio: 3 },
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
        qty,
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
    console.log("=== TSLA Smart Gap Analysis ===\n");

    const transactionsSnap = await db.collectionGroup('transactions').get();
    const tslaTxs: any[] = [];

    transactionsSnap.docs.forEach(doc => {
        const data = doc.data();
        const sym = (data.symbol || '').toUpperCase();

        if (sym === 'TSLA' || sym.startsWith('TSLA ')) {
            const normalized = normalizeFireTx({ ...data, id: doc.id });
            if (normalized.assetType === 'stock') {
                tslaTxs.push(normalized);
            }
        }
    });

    tslaTxs.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    let runningBalance = 0;
    let lastZeroDate = "START (No prior zero)";
    let lastZeroIndex = -1;

    // 1. First Pass: Find the LAST point where balance was >= 0
    // Actually, we want the last point where balance was ~0 before it went negative permanently.
    // Or simpler: Find the point where it dives into negativity and stays there until the end.

    // Let's trace the balance and record every time it hits 0.
    const zeroPoints: number[] = []; // indices where balance is close to 0

    // Initial state is 0, so index -1 is a zero point effectively.

    for (let i = 0; i < tslaTxs.length; i++) {
        const t = tslaTxs[i];
        const splitFactor = getCumulativeSplitFactor(t.symbol, t.transactionTimestamp);
        const adjQty = t.qty * splitFactor;
        runningBalance += adjQty;

        if (Math.abs(runningBalance) < 0.001) {
            lastZeroDate = t.date;
            lastZeroIndex = i;
        }
    }

    console.log(`[Analysis Summary]`);
    console.log(`Total Transactions Logged: ${tslaTxs.length}`);
    console.log(`Final Calculated Balance : ${runningBalance.toFixed(2)}`);
    console.log(`Last 'Clean Slate' (Zero Balance) Date: ${lastZeroDate}`);
    console.log(`Transactions after Last Zero: ${tslaTxs.length - 1 - lastZeroIndex}`);

    console.log(`\n[The Permanent Divergence]`);
    console.log(`Listing ledger operations occurring AFTER the balance last hit zero (${lastZeroDate}).`);
    console.log(`These are the specific operations causing the permanent negative drift.`);
    console.log(`\nDate       | Action | Side  | AdjQty     | Balance    | ID                   | Note`);
    console.log(`-----------|--------|-------|------------|------------|----------------------|-----`);

    let divergentBalance = 0; // tracking balance for just this segment? No, let's track global balance from that point.
    // wait, if lastZeroIndex is the index OF the zero balance, the next one is start of divergence.

    // We need to re-calculate balance from scratch to print it correctly for the visualization
    runningBalance = 0;
    for (let i = 0; i < tslaTxs.length; i++) {
        const t = tslaTxs[i];
        const splitFactor = getCumulativeSplitFactor(t.symbol, t.transactionTimestamp);
        const adjQty = t.qty * splitFactor;
        runningBalance += adjQty;

        if (i > lastZeroIndex) {
            const dateStr = t.date;
            const actionStr = (t.raw.type || '').slice(0, 6).padEnd(7);
            const sideStr = t.side.padEnd(5);
            const qtyStr = adjQty.toFixed(2).padStart(10);
            const balStr = runningBalance.toFixed(2).padStart(10);
            const idStr = t.id.padEnd(20);

            let note = "";
            if (i === lastZeroIndex + 1) note = "<< THE BREAK POINT";

            console.log(`${dateStr} | ${actionStr}| ${sideStr} | ${qtyStr} | ${balStr} | ${idStr} | ${note}`);
        }
    }
}

main().catch(console.error);
