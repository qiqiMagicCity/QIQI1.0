
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

// Helper to mimic internal project logic
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

function normalizeFireTx(raw: any, source: string): any {
    const symbolRaw = pickFirst<string>(raw, ['symbol', 'ticker', 'underlying', 'symbolRoot', 'optionDetails.symbol']);
    const symbolClean = symbolRaw != null ? String(symbolRaw).trim() : '';
    const symbolUpper = symbolClean.toUpperCase();

    // Logic from use-user-transactions.ts
    const atCand = (pickFirst<any>(raw, ['assetType', 'securityType', 'instrumentType']) ?? '').toString().toLowerCase();
    let assetType = atCand.includes('option') ? 'option' : 'stock';

    // ... (Simplified logic for Asset Type detection)
    if (assetType === 'stock') {
        const tText = String(raw.type ?? '').toLowerCase();
        if (tText === 'option' || tText.includes('option')) assetType = 'option';
    }

    const qtySrc = pickFirst<any>(raw, ['qty', 'quantity', 'shares', 'contracts', 'size']);
    let qty = Number(qtySrc);
    if (isNaN(qty)) qty = 0;

    const multiplier = typeof raw.multiplier === 'number' ? raw.multiplier : (assetType === 'option' ? 100 : 1);

    return {
        id: raw.id,
        symbol: symbolUpper,
        assetType,
        qty,
        multiplier,
        transactionTimestamp: raw.transactionTimestamp || 0,
        raw
    };
}

// Logic from fifo.ts
function buildHypothesis(transactions: any[]) {
    // 1. Group by Normalized Symbol (REMOVING assetType from key!)
    const groups = new Map<string, any[]>();

    for (const tx of transactions) {
        // fifo.ts Line 191:
        const normalizedSymbolForAgg = tx.symbol.toUpperCase().replace(/\s+/g, '');
        const key = normalizedSymbolForAgg; // The critical flaw?

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(tx);
    }

    // 2. Process BA Group
    const baGroup = groups.get('BA');
    if (!baGroup) {
        console.log("No BA group found.");
        return;
    }

    console.log(`\nFound names in BA group: ${baGroup.length} transactions`);

    // Sort
    baGroup.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    // fifo.ts Line 221
    // The symbol used here is from the LAST transaction in the group
    const lastTx = baGroup[baGroup.length - 1];
    const symbol = lastTx.symbol.toUpperCase().replace(/\s+/g, '');

    const isOccOption = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol); // "BA" fails this
    const derivedAssetType = isOccOption ? 'option' : 'stock';
    const finalMultiplier = derivedAssetType === 'stock' ? 1 : (baGroup[0].multiplier ?? 100);

    console.log(`Aggregator Decision for Group "BA":`);
    console.log(`- Derived Asset Type: ${derivedAssetType} (isOccOption=${isOccOption})`);
    console.log(`- Final Multiplier: ${finalMultiplier}`);

    let netQty = 0;

    console.log(`\n--- Transaction Trace ---`);
    console.log(`ID | Date | AssetType(Raw) | Qty | Aggregated as Stock(Qty)?`);

    let runningTotal = 0;

    baGroup.forEach(tx => {
        const isSuspect = tx.assetType === 'option'; // In raw data
        const valueChange = tx.qty; // Since multiplier is 1 for stock
        runningTotal += valueChange;

        console.log(`${tx.id.padEnd(20)} | ${new Date(tx.transactionTimestamp).toISOString().slice(0, 10)} | ${tx.assetType} | ${tx.qty} | Total: ${runningTotal}`);

        if (isSuspect) {
            console.log(`    >>> SUSPECT: Option processed as Stock? Raw Multiplier: ${tx.multiplier}`);
        }
    });

    console.log(`\nFinal Net Quantity: ${runningTotal}`);
}

async function main() {
    console.log("=== Running Mock Verification for BA Option Bug ===\n");

    const mockTransactions = [
        // Suspect 1: 2025-01-29 Sell Close 5 Contracts
        // Emulating how it might look in raw Firestore if imported with basic "BA" symbol
        {
            id: 'mock_suspect_1',
            symbol: 'BA', // The simplified symbol causing the issue
            assetType: 'option', // Correctly tagged in raw data
            qty: -5, // Sell 5
            side: 'SELL',
            price: 15.20, // Option price
            multiplier: 100,
            transactionTimestamp: new Date('2025-01-29T10:00:00Z').getTime(),
            opKind: 'STC'
        },
        // Suspect 2: 2025-04-29 Sell Close 5 Contracts
        {
            id: 'mock_suspect_2',
            symbol: 'BA',
            assetType: 'option',
            qty: -5,
            side: 'SELL',
            price: 12.50,
            multiplier: 100,
            transactionTimestamp: new Date('2025-04-29T10:00:00Z').getTime(),
            opKind: 'STC'
        }
    ];

    console.log("Input: Mock Raw Transactions (AssetType='option', Multiplier=100, Symbol='BA')");
    mockTransactions.forEach(t => console.log(` - ID: ${t.id}, Qty: ${t.qty}, Type: ${t.assetType}, Symbol: ${t.symbol}`));

    // Normalize (Simulating use-user-transactions.ts)
    const normalized = mockTransactions.map(t => normalizeFireTx(t, 'transactions'));

    // Aggregate (Simulating fifo.ts)
    console.log("\nRunning Aggregation Logic...");
    buildHypothesis(normalized);
}

main();
