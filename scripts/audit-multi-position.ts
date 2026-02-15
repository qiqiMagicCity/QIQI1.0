
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
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
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

async function runAuditInternal() {
    const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
    const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();

    const allRaw = [
        ...txSnap.docs.map(d => ({ ...d.data(), id: d.id, source: 'transactions' })),
        ...tradeSnap.docs.map(d => ({ ...d.data(), id: d.id, source: 'trades' }))
    ];

    // 1. ABNB (Short Position)
    const abnbRaw = allRaw.filter(t => (t.symbol || '').includes('ABNB')).map(normalize);
    const resAbnb = calcGlobalFifo({ transactions: abnbRaw as any, todayNy: '2026-02-14' });

    let abnbRealized = resAbnb.totalRealizedPnl;
    let abnbNetQty = 0;
    let abnbCostBasis = 0;
    const priceAbnb = 121.35;

    for (const [sym, lots] of resAbnb.openPositions.entries()) {
        lots.forEach((lot: any) => {
            abnbNetQty += lot.qty;
            abnbCostBasis += lot.qty * lot.cost * lot.multiplier;
        });
    }
    const abnbMv = abnbNetQty * 1 * priceAbnb;
    const abnbUnrealized = abnbMv - abnbCostBasis;

    console.log(`[ABNB_AUDIT] netQty=${abnbNetQty}, costBasis=${abnbCostBasis.toFixed(2)}, priceUsed=${priceAbnb}, mv=${abnbMv.toFixed(2)}, unrealized=${abnbUnrealized.toFixed(2)}, realized=${abnbRealized.toFixed(2)}, totalLifetime=${(abnbRealized + abnbUnrealized).toFixed(2)}`);

    // 2. LONG
    const allSymbols = Array.from(new Set(allRaw.map(t => t.symbol).filter(Boolean)));
    for (const symToken of allSymbols) {
        if (symToken === 'ABNB') continue;
        const symRaw = allRaw.filter(t => t.symbol === symToken).map(normalize);
        const res = calcGlobalFifo({ transactions: symRaw as any, todayNy: '2026-02-14' });

        let netQty = 0;
        let costBasis = 0;
        for (const [s, lots] of res.openPositions.entries()) {
            lots.forEach((l: any) => { netQty += l.qty; costBasis += l.qty * l.cost * l.multiplier; });
        }

        if (netQty > 0) {
            const mockPrice = 200;
            const mv = netQty * 1 * mockPrice;
            const unrealized = mv - costBasis;
            console.log(`[LONG_AUDIT] symbol=${symToken}, netQty=${netQty}, costBasis=${costBasis.toFixed(2)}, priceUsed=${mockPrice}, mv=${mv.toFixed(2)}, unrealized=${unrealized.toFixed(2)}, realized=${res.totalRealizedPnl.toFixed(2)}, totalLifetime=${(res.totalRealizedPnl + unrealized).toFixed(2)}`);
            break;
        }
    }
}

runAuditInternal().catch(console.error);
