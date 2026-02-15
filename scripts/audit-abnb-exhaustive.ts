
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { calcGlobalFifo } from '../src/lib/pnl/calc-m4-m5-2-global-fifo';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'studio-9804216494-c2b75' });
}
const db = getFirestore();
const uid = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

// Copied normalization from use-user-transactions.ts
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
    for (const v of keys.map(k => obj[k])) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
}

function normalize(raw: any) {
    const qtySrc = pickFirst(raw, ['qty', 'quantity', 'shares', 'size', 'filledQty']);
    const priceSrc = pickFirst(raw, ['price', 'fillPrice', 'avgPrice', 'tradePrice']);
    const qtyNum = parseNumberLoose(qtySrc) ?? 0;
    const priceNum = parseNumberLoose(priceSrc) ?? 0;
    const side = (raw.side || raw.type || raw.action || '').toUpperCase();
    let qty = qtyNum;
    if (side.includes('SELL') || side.includes('SHORT') || side.includes('STC') || side.includes('STO')) {
        qty = -Math.abs(qtyNum);
    } else {
        qty = Math.abs(qtyNum);
    }
    return { ...raw, qty, price: priceNum, multiplier: raw.multiplier || 1, transactionTimestamp: raw.transactionTimestamp || 0 };
}

async function audit() {
    const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
    const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();

    // Combine both lanes as the app does
    const allRaw = [
        ...txSnap.docs.map(d => ({ ...d.data(), id: d.id, source: 'transactions' })),
        ...tradeSnap.docs.map(d => ({ ...d.data(), id: d.id, source: 'trades' }))
    ];

    const abnbTxs = allRaw.filter(t => (t.symbol || '').includes('ABNB')).map(normalize);
    console.log(`Analyzing ${abnbTxs.length} normalized ABNB transactions...`);

    const res = calcGlobalFifo({ transactions: abnbTxs as any, todayNy: '2026-02-14' });

    let totalRealized = 0;
    res.auditTrail.forEach(e => {
        totalRealized += e.pnl;
    });

    const currentPrice = 121.35;
    let totalUnrealized = 0;
    for (const [sym, lots] of res.openPositions.entries()) {
        lots.forEach((lot: any) => {
            const pnl = (lot.qty > 0)
                ? (currentPrice - lot.cost) * lot.qty * lot.multiplier
                : (lot.cost - currentPrice) * Math.abs(lot.qty) * lot.multiplier;
            totalUnrealized += pnl;
        });
    }

    console.log(`\n[ABNB_REPORT] Realized: ${totalRealized}, Unrealized: ${totalUnrealized}, Total: ${totalRealized + totalUnrealized}`);
}

audit().catch(console.error);
