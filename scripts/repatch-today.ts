import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}
const db = getFirestore();

async function repatch() {
    const today = '2026-02-09';
    console.log(`Re-patching patch_script results for ${today} (No Index version)...`);

    // Fetch all for today and filter in JS
    const snap = await db.collection('officialCloses')
        .where('tradingDate', '==', today)
        .get();

    const patchDocs = snap.docs.filter(d => d.data().provider === 'patch_script');
    console.log(`Found ${patchDocs.length} records to check.`);

    for (const d of patchDocs) {
        const data = d.data();
        const symbol = data.symbol;
        const currentPrice = data.close;

        // Fetch all history for this symbol
        const historySnap = await db.collection('officialCloses')
            .where('symbol', '==', symbol)
            .get();

        const sorted = historySnap.docs
            .map(doc => doc.data())
            .filter(h => h.tradingDate < today)
            .sort((a, b) => b.tradingDate.localeCompare(a.tradingDate));

        if (sorted.length > 0) {
            const lastData = sorted[0];
            const lastPrice = lastData.close;

            if (Math.abs(currentPrice - lastPrice) > 0.001) {
                console.log(`[FIXING] ${symbol}: ${currentPrice} -> ${lastPrice} (Carry from ${lastData.tradingDate})`);

                const newRev = (data.rev || 0) + 1;
                await db.collection('officialCloses').doc(d.id).update({
                    close: lastPrice,
                    provider: 'repatch_fix',
                    rev: newRev
                });

                await db.collection('stockDetails').doc(symbol).set({
                    eodRevision: newRev,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } else {
                console.log(`[OK] ${symbol}: Price matches history ($${currentPrice})`);
            }
        } else {
            console.log(`[KEEP] ${symbol}: No history found, keeping $${currentPrice}`);
        }
    }
    console.log("Done.");
}

repatch().catch(console.error);
