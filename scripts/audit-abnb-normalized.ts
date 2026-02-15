
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { calcGlobalFifo } from '../src/lib/pnl/calc-m4-m5-2-global-fifo';

// Mocking the normalization logic from use-user-transactions.ts
function parseNumberLoose(v: any): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        let t = v.trim().replace(/\u2212/g, '-').replace(/[, \u00A0]/g, '');
        const neg = /^\(.*\)$/.test(t);
        t = t.replace(/[()]/g, '');
        if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
            const n = Number(t);
            if (!Number.isFinite(n)) return null;
            return neg ? -Math.abs(n) : n;
        }
    }
    return null;
}

function pickFirst(obj: any, keys: string[]) {
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
    }
    return undefined;
}

function normalizeFireTx(raw: any): any {
    const qtySrc = pickFirst(raw, ['qty', 'quantity', 'shares', 'contracts', 'size', 'filledQty', 'filledQuantity', 'orderQty', 'optionDetails.quantity']);
    const priceSrc = pickFirst(raw, ['price', 'fillPrice', 'avgPrice', 'averagePrice', 'pricePerUnit', 'premium', 'tradePrice', 'executionPrice', 'optionDetails.price']);
    const qtyNum = parseNumberLoose(qtySrc) ?? 0;
    const priceNum = parseNumberLoose(priceSrc) ?? 0;

    // Side logic
    const side = (raw.side || raw.type || '').toUpperCase();
    let qty = qtyNum;
    if (side === 'SELL' || side === 'SHORT' || side === 'STO' || side === 'STC') {
        qty = -Math.abs(qtyNum);
    } else {
        qty = Math.abs(qtyNum);
    }

    return {
        ...raw,
        qty,
        price: priceNum,
        multiplier: raw.multiplier || 1,
        transactionTimestamp: raw.transactionTimestamp || 0,
        symbol: raw.symbol
    };
}

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'studio-9804216494-c2b75' });
}
const db = getFirestore();
const uid = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function runAudit() {
    const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
    const rawTxs = txSnap.docs.map(d => ({ ...d.data(), id: d.id }));

    const abnbRaw = rawTxs.filter((t: any) => t.symbol === 'ABNB');
    const abnbNorm = abnbRaw.map(normalizeFireTx);

    const res = calcGlobalFifo({
        transactions: abnbNorm as any,
        todayNy: '2026-02-14'
    });

    console.log(`\n=== ABNB Audit Trail (Normalized) ===`);
    let totalRealized = 0;
    res.auditTrail.forEach(e => {
        totalRealized += e.pnl;
        console.log(`Trade: ${e.openDate} -> ${e.closeDate} | Qty: ${e.qty} | PnL: ${e.pnl}`);
    });

    console.log(`\n=== Open Positions ===`);
    const currentPrice = 121.35;
    let totalUnrealized = 0;
    for (const [sym, lots] of res.openPositions.entries()) {
        lots.forEach((lot: any) => {
            const pnl = lot.qty * (currentPrice - lot.cost) * lot.multiplier;
            totalUnrealized += pnl;
            console.log(`LOT: Qty=${lot.qty}, Cost=${lot.cost}, Unrealized=${pnl}`);
        });
    }

    console.log(`\n[ABNB_DEBUG] netQty=-555, costBasis=?, priceUsed=${currentPrice}, unrealizedPnl=${totalUnrealized}, realizedPnlLifetime=${totalRealized}, totalPnl=${totalRealized + totalUnrealized}`);
}

runAudit().catch(console.error);
