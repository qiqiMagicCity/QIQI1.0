
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { calcGlobalFifo } from '../src/lib/pnl/calc-m4-m5-2-global-fifo';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'studio-9804216494-c2b75' });
}
const db = getFirestore();
const uid = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

// Simple normalization to match app logic
function normalize(t: any) {
    const qty = Number(t.qty || t.quantity || 0);
    const price = Number(t.price || 0);
    const side = (t.side || t.type || '').toUpperCase();
    const multiplier = t.multiplier || 1;

    let signedQty = qty;
    if (side === 'SELL' || side === 'SHORT' || side === 'STO' || side === 'STC') {
        signedQty = -Math.abs(qty);
    } else {
        signedQty = Math.abs(qty);
    }

    return {
        ...t,
        qty: signedQty,
        price,
        multiplier
    };
}

async function runAudit() {
    const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
    const rawTxs = txSnap.docs.map(d => ({ ...d.data(), id: d.id }));

    const abnbTxs = rawTxs.filter((t: any) => t.symbol === 'ABNB').map(normalize);
    abnbTxs.sort((a: any, b: any) => a.transactionTimestamp - b.transactionTimestamp);

    const res = calcGlobalFifo({
        transactions: abnbTxs as any,
        todayNy: '2026-02-14'
    });

    console.log(`\n=== ABNB Open Positions ===`);
    const currentPrice = 121.35;
    let totalUnrealized = 0;

    for (const [sym, lots] of res.openPositions.entries()) {
        lots.forEach((lot: any) => {
            // MV - CostBasis
            const mv = lot.qty * currentPrice * lot.multiplier;
            const costBasis = lot.qty * lot.cost * lot.multiplier;
            const pnl = mv - costBasis;
            totalUnrealized += pnl;
            console.log(`LOT: Qty=${lot.qty}, Cost=${lot.cost}, MV=${mv.toFixed(2)}, CostBasis=${costBasis.toFixed(2)}, PnL=${pnl.toFixed(2)}`);
        });
    }

    console.log(`\n=== Audit Trail ===`);
    let totalRealized = 0;
    res.auditTrail.forEach(e => {
        totalRealized += e.pnl;
        console.log(`Audit: ${e.closeDate} | Qty: ${e.qty} | PnL: ${e.pnl.toFixed(2)} | OpenPrice: ${e.openPrice} | ClosePrice: ${e.closePrice}`);
    });

    console.log(`\nSummary:`);
    console.log(`Total Realized: ${totalRealized.toFixed(2)}`);
    console.log(`Total Unrealized @ ${currentPrice}: ${totalUnrealized.toFixed(2)}`);
    console.log(`Total Lifetime PnL: ${(totalRealized + totalUnrealized).toFixed(2)}`);
}

runAudit().catch(err => {
    console.error("AUDIT FAILED:", err);
});
