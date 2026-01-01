
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

import { toNyCalendarDayString } from '@/lib/ny-time';


// Try to load service account from user's specified path
const SERVICE_ACCOUNT_PATH = 'C:\\Users\\QiQi_\\.gemini\\service_account_key.json';

const DATE_OCT_31 = '2025-10-31';
const DATE_NOV_END = '2025-11-30';
const DATE_NOV_LAST_TRADING = '2025-11-28';

// --- Types ---
interface Transaction {
    id: string;
    symbol: string;
    type: string;
    side: string;
    qty: number;
    price: number;
    transactionTimestamp: number;
    date: string; // Derived or field
}

interface Position {
    symbol: string;
    quantity: number;
    costBasis: number; // Unit cost
    dateAcquired: string;
}

interface EodMap {
    [symbol: string]: number;
}

// --- Init ---
function initFirebase() {
    if (admin.apps.length) return;

    if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        console.log(`[Audit] Loading service account from: ${SERVICE_ACCOUNT_PATH}`);
        try {
            const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('[Audit] Firebase Admin initialized with Service Account.');
        } catch (e) {
            console.error('[Audit] Failed to load service account key:', e);
            process.exit(1);
        }
    } else {
        console.log('[Audit] Service account key not found at default path.');
        console.log('[Audit] Trying Application Default Credentials (ADC)...');
        try {
            admin.initializeApp();
        } catch (e) {
            console.error('[Audit] ADC initialization failed.', e);
            process.exit(1);
        }
    }
}

async function runAudit() {
    initFirebase();
    const db = admin.firestore();

    console.log('================================================================');
    console.log('              FORENSIC PnL AUDIT - NOVEMBER 2025                ');
    console.log('================================================================');

    // 1. Discover Users
    console.log('[Audit] Scanning users...');
    const usersSnap = await db.collection('users').get();
    if (usersSnap.empty) {
        console.error('[Audit] No users found in "users" collection.');
        // Fallback: Check if transactions exist at root (legacy?)
        const rootTx = await db.collection('transactions').limit(1).get();
        if (!rootTx.empty) {
            console.log('[Audit] Found "transactions" at root. Analyzing root collection...');
            await analyzeCollection(db, db.collection('transactions'));
        }
        return;
    }

    console.log(`[Audit] Found ${usersSnap.size} user(s).`);

    for (const userDoc of usersSnap.docs) {
        console.log(`\n>>> AUDITING USER: ${userDoc.id} <<<`);
        const txCol = db.collection('users').doc(userDoc.id).collection('transactions');
        await analyzeCollection(db, txCol);
    }
}

async function analyzeCollection(db: admin.firestore.Firestore, txCol: admin.firestore.CollectionReference) {
    // 1. Fetch All Transactions
    const txSnap = await txCol.get();
    const allDocs = txSnap.docs.map(doc => {
        const d = doc.data();
        // Normalize fields based on use-user-transactions.ts logic
        // We need: symbol, qty, price, timestamp, side/type

        let symbol = d.symbol || d.ticker || 'UNKNOWN';
        symbol = symbol.toUpperCase().trim();

        let qty = Number(d.qty || d.quantity || d.shares || 0);
        let price = Number(d.price || d.fillPrice || d.avgPrice || 0);

        // Timestamp
        let ts = 0;
        if (d.transactionTimestamp && typeof d.transactionTimestamp.toMillis === 'function') {
            ts = d.transactionTimestamp.toMillis();
        } else if (typeof d.transactionTimestamp === 'number') {
            ts = d.transactionTimestamp;
        } else if (d.date) {
            ts = new Date(d.date).getTime();
        }

        // Date String (YYYY-MM-DD)
        // If ts is valid, use it to get NY Date
        const dateStr = ts > 0
            ? toNyCalendarDayString(ts)
            : (d.date || '1970-01-01');

        // Type/Side Inference
        // We need simplify: BUY vs SELL.
        // If option, handle appropriately? 
        // For 'November PnL', user implies stock/option.
        // We assume Qty is SIGNED? Or use Side?
        // use-user-transactions.ts normalizes Qty to be signed based on Side.
        // Let's assume raw data might be unsigned.

        const typeRaw = (d.type || d.action || d.side || '').toUpperCase();
        let side = 'UNKNOWN';
        if (typeRaw.includes('BUY') || typeRaw.includes('COVER')) side = 'BUY';
        if (typeRaw.includes('SELL') || typeRaw.includes('SHORT')) side = 'SELL';

        // Adjust Qty Sign
        if (side === 'SELL' && qty > 0) qty = -qty;
        if (side === 'BUY' && qty < 0) qty = Math.abs(qty);

        return {
            id: doc.id,
            symbol,
            type: side, // 'BUY' or 'SELL'
            side,
            qty,
            price,
            transactionTimestamp: ts,
            date: dateStr
        } as Transaction;
    });

    const relevantTxs = allDocs.filter(t => t.date <= DATE_NOV_END).sort((a, b) => {
        return a.transactionTimestamp - b.transactionTimestamp;
    });

    console.log(`[Audit] Loaded ${relevantTxs.length} relevant transactions (<= ${DATE_NOV_END}).`);

    // Identify Symbols
    const activeSymbols = new Set<string>(relevantTxs.map(t => t.symbol));

    // Fetch Prices
    console.log('[Audit] Fetching EOD prices...');
    const pricesOct31 = await fetchPrices(db, DATE_OCT_31, Array.from(activeSymbols));
    const pricesNovLast = await fetchPrices(db, DATE_NOV_LAST_TRADING, Array.from(activeSymbols));

    // --- Strict FIFO Engine ---
    const inventory = new Map<string, Position[]>();

    // PnL Stores
    let realizedPnlNov = 0;
    const realizedDetails: Record<string, number> = {};

    // Oct 31 Snapshots
    const unrealizedOct31: Record<string, number> = {};
    const valueOct31: Record<string, number> = {};
    const costOct31: Record<string, number> = {};

    let phase = 'PRE_NOV'; // PRE_NOV or NOV

    // We iterate chronologically
    for (const tx of relevantTxs) {
        // Detect phase change
        if (phase === 'PRE_NOV' && tx.date > DATE_OCT_31) {
            // SNAPSHOT STATE OCT 31
            phase = 'NOV';
            // We need to capture state BEFORE this transaction
            // Implies: Snapshot logic should ideally run *between* the batch.
            // Since we loop item by item, we can just snapshot NOW (Inventory is at Oct 31 state).
            snapshotInventory(inventory, pricesOct31, unrealizedOct31, valueOct31, costOct31);
        }

        const sym = tx.symbol;
        if (!inventory.has(sym)) inventory.set(sym, []);
        const queue = inventory.get(sym)!;

        // SKIP SPLITS/DIVIDENDS/CASH for simplicity (WARN)
        if (tx.type !== 'BUY' && tx.type !== 'SELL') {
            // console.warn(`[Skip] Unknown type ${tx.type} for ${sym}`);
            continue;
        }

        if (tx.qty > 0) {
            // BUY
            queue.push({
                symbol: sym,
                quantity: tx.qty,
                costBasis: tx.price, // Assuming cost is price (ignore fees for now)
                dateAcquired: tx.date
            });
        } else {
            // SELL (qty is negative)
            let qtyToClose = Math.abs(tx.qty);
            let revenue = 0;
            let cost = 0;

            // Match FIFO
            while (qtyToClose > 0.000001) {
                if (queue.length === 0) {
                    // Short Selling / Overselling
                    // For audit, assume Cost = 0 (Pure Profit) ?? Or use current price?
                    // Let's assume Cost = 0 to flag it.
                    // Or actually, if it's a SHORT, we should track short queue?
                    // If queue is empty, we are opening a SHORT position.
                    // Complexity: Shorting requires separate queue or negative qty handling.
                    // Simplified: We assume Long-Only or warn.
                    // If we short, we push a negative position?
                    // Let's WARN and skip computation for that portion to avoid massive noise.
                    // console.warn(`[WARN] Short/Oversell detected for ${sym} on ${tx.date}. Logic assumes Long-Only FIFO.`);
                    break;
                }

                const head = queue[0];
                // Check if head is positive (Long)
                // If head is negative (Short), we are covering?
                // Assuming standard Long inventory for now.

                const available = head.quantity;
                const match = Math.min(available, qtyToClose);

                revenue += match * tx.price;
                cost += match * head.costBasis;

                qtyToClose -= match;
                head.quantity -= match;

                if (head.quantity <= 0.000001) {
                    queue.shift();
                }
            }

            const pnl = revenue - cost;
            // Only track Realized PnL if we are in NOV phase
            if (phase === 'NOV') {
                realizedPnlNov += pnl;
                if (!realizedDetails[sym]) realizedDetails[sym] = 0;
                realizedDetails[sym] += pnl;
            }
        }
    }

    // If we never switched to NOV (no trades in Nov), we still snapshot at end?
    if (phase === 'PRE_NOV') {
        snapshotInventory(inventory, pricesOct31, unrealizedOct31, valueOct31, costOct31);
        phase = 'NOV_DONE';
    }

    // --- End of Nov Evaluation ---
    const unrealizedNov: Record<string, number> = {};
    const valueNov: Record<string, number> = {};
    const costNov: Record<string, number> = {};

    snapshotInventory(inventory, pricesNovLast, unrealizedNov, valueNov, costNov);

    // --- Results ---
    const allSyms = new Set([...Object.keys(realizedDetails), ...Object.keys(unrealizedOct31), ...Object.keys(unrealizedNov)]);
    const results = [];
    let grandTotal = 0;

    for (const sym of allSyms) {
        const r = realizedDetails[sym] || 0;
        const uStart = unrealizedOct31[sym] || 0;
        const uEnd = unrealizedNov[sym] || 0;
        const uChange = uEnd - uStart;
        const total = r + uChange;
        grandTotal += total;

        results.push({ sym, r, uChange, total, uStart, uEnd });
    }

    results.sort((a, b) => a.total - b.total);

    console.log(`\n-------------------------------------------------------------`);
    console.log(`AUDIT REPORT FOR USER: ${txCol.parent?.id}`);
    console.log(`Date Range: ${DATE_OCT_31} -> ${DATE_NOV_END}`);
    console.log(`-------------------------------------------------------------`);
    console.log(`SYM       | REALIZED | UNRL CHG | TOTAL PnL | (UNRL START -> END)`);

    results.forEach(res => {
        if (Math.abs(res.total) < 0.01 && Math.abs(res.r) < 0.01) return;
        console.log(
            `${res.sym.padEnd(9)} | ` +
            `${res.r.toFixed(2).padStart(8)} | ` +
            `${res.uChange.toFixed(2).padStart(8)} | ` +
            `${res.total.toFixed(2).padStart(9)} | ` +
            `(${res.uStart.toFixed(0)} -> ${res.uEnd.toFixed(0)})`
        );
    });

    console.log(`-------------------------------------------------------------`);
    console.log(`GRAND TOTAL PnL: ${grandTotal.toFixed(2)}`);
    console.log(`-------------------------------------------------------------`);
}

function snapshotInventory(
    inventory: Map<string, Position[]>,
    prices: EodMap,
    unrlStore: Record<string, number>,
    valueStore: Record<string, number>,
    costStore: Record<string, number>
) {
    for (const [sym, queue] of inventory.entries()) {
        const qty = queue.reduce((s, i) => s + i.quantity, 0);
        if (qty <= 0.000001) continue;

        const price = prices[sym] || 0;
        const marketVal = qty * price;

        let totalCost = 0;
        queue.forEach(p => totalCost += (p.quantity * p.costBasis));

        valueStore[sym] = marketVal;
        costStore[sym] = totalCost;
        unrlStore[sym] = marketVal - totalCost;

        if (price === 0) {
            // console.warn(`[WARN] Zero price for ${sym} at snapshot. Unrl PnL might be skewed.`);
        }
    }
}

async function fetchPrices(db: admin.firestore.Firestore, date: string, symbols: string[]): Promise<EodMap> {
    const map: EodMap = {};
    if (symbols.length === 0) return map;

    // Chunking 10
    for (let i = 0; i < symbols.length; i += 10) {
        const chunk = symbols.slice(i, i + 10);
        const ids = chunk.map(s => `${date}_${s}`);
        const refs = ids.map(id => db.collection('officialCloses').doc(id));

        const snaps = await db.getAll(...refs);
        snaps.forEach(snap => {
            if (snap.exists) {
                const d = snap.data();
                const sym = d?.symbol || snap.id.split('_')[1];
                if (sym && d?.close) map[sym] = Number(d.close);
            }
        });
    }
    return map;
}

runAudit().catch(console.error);
