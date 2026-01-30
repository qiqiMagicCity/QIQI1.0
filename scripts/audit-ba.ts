
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// 1. Initialize Firebase
if (!admin.apps.length) {
    try {
        admin.initializeApp();
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

    // Fix side/qty sign logic (simplified)
    const side = raw.side || (qty > 0 ? 'BUY' : 'SELL');
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

async function main() {
    console.log("=== BA Audit Script ===");
    const usersSnap = await db.collection('users').get();
    console.log(`Scanning ${usersSnap.size} users...`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;

        const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
        const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();

        const allTxs: any[] = [];
        txSnap.docs.forEach(d => allTxs.push({ ...d.data(), id: d.id, _source: 'transactions' }));
        tradeSnap.docs.forEach(d => allTxs.push({ ...d.data(), id: d.id, _source: 'trades' }));

        const normalized = allTxs.map(t => normalizeFireTx(t));
        const baTxs = normalized.filter(t => t.symbol === 'BA' || t.symbol.includes('BA ')); // BA or 'BA '

        if (baTxs.length > 0) {
            console.log(`\n\nUSER: ${uid} (Found ${baTxs.length} BA records)`);
            console.log(`-----------------------------------------------------------------------------------------`);
            console.log(`| Date       | ID                   | Type   | Qty  | Mult | RawType | RawSym`);
            console.log(`-----------------------------------------------------------------------------------------`);

            baTxs.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

            let stockNet = 0;
            let optionNet = 0;
            let pollutedStockNet = 0;

            baTxs.forEach(t => {
                const isOption = t.assetType === 'option';

                // Real Logic Stats
                if (isOption) optionNet += t.qty;
                else stockNet += t.qty;

                // Polluted Logic Stats (Old Bug: If Symbol is not OCC, treat as Stock)
                const isOcc = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(t.symbol.replace(/\s+/g, ''));
                const bugAsStock = !isOcc; // Old logic: if not OCC, it forced stock

                if (bugAsStock) {
                    pollutedStockNet += t.qty; // Treated as share count (multiplier 1)
                }

                console.log(`| ${t.date} | ${t.id.padEnd(20)} | ${t.assetType.padEnd(6)} | ${String(t.qty).padEnd(4)} | ${String(t.multiplier).padEnd(4)} | ${(t.raw.assetType || '').padEnd(7)} | ${t.raw.symbol}`);
            });

            console.log(`-----------------------------------------------------------------------------------------`);
            console.log(`Analysis for User ${uid}:`);
            console.log(`[Correct Logic] Stock Net:  ${stockNet}`);
            console.log(`[Correct Logic] Option Net: ${optionNet} (Contracts)`);
            console.log(`[Buggy Logic]   Stock Net:  ${pollutedStockNet} (This matches '499.81'?)`);

            if (Math.abs(pollutedStockNet - 499.81) < 1) {
                console.log(">>> MATCH FOUND! This user has the polluted 499.81 issue.");
            }
        }
    }
}

main().catch(console.error);
