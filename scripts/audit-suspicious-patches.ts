import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}
const db = getFirestore();

async function audit() {
    const today = '2026-02-09';
    console.log(`Auditing patch_script results for ${today}...`);

    const snap = await db.collection('officialCloses')
        .where('tradingDate', '==', today)
        .where('provider', '==', 'patch_script')
        .get();

    for (const d of snap.docs) {
        const data = d.data();
        const symbol = data.symbol;
        const currentPrice = data.close;

        // Get previous price
        const prevSnap = await db.collection('officialCloses')
            .where('symbol', '==', symbol)
            .where('tradingDate', '<', today)
            .orderBy('tradingDate', 'desc')
            .limit(1)
            .get();

        if (!prevSnap.empty) {
            const prevData = prevSnap.docs[0].data();
            const prevPrice = prevData.close;
            const diffPct = Math.abs((currentPrice - prevPrice) / prevPrice);

            if (diffPct > 0.1) { // More than 10% change on a fallback is suspicious
                console.log(`[SUSPECT] ${symbol}: Today=${currentPrice}, Prev(${prevData.tradingDate})=${prevPrice}, Diff=${(diffPct * 100).toFixed(2)}%`);

                // Auto fix? 
                // Let's just list them first.
            } else {
                console.log(`[OK] ${symbol}: Diff=${(diffPct * 100).toFixed(2)}%`);
            }
        } else {
            console.log(`[NEW] ${symbol}: No history, Using cost=${currentPrice}`);
        }
    }
}

audit().catch(console.error);
