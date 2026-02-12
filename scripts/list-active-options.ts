
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function listActiveOptions() {
    console.log('🔍 正在列出所有活跃期权持仓...');

    const holdings: Record<string, number> = {};
    const assetTypes: Record<string, string> = {};

    const snapshot = await db.collection('transactions').get();

    snapshot.forEach(doc => {
        const tx = doc.data();
        const symbol = tx.symbol;
        if (!symbol) return;

        const qty = Number(tx.quantity || 0);
        holdings[symbol] = (holdings[symbol] || 0) + qty;
        assetTypes[symbol] = tx.assetType || 'stock';
    });

    const activeSymbols = Object.keys(holdings).filter(s => Math.abs(holdings[s]) > 0.0001);

    let optionCount = 0;
    console.log('\n--- 活跃期权列表 ---');

    for (const s of activeSymbols) {
        if (assetTypes[s] === 'option') {
            console.log(`🎯 [OPTION] ${s}: ${holdings[s]}`);
            optionCount++;

            // Try to find ANY EOD data for it
            const eodSnap = await db.collection('officialCloses')
                .where('symbol', '==', s)
                .orderBy('date', 'desc')
                .limit(1)
                .get();

            if (eodSnap.empty) {
                console.log(`    ❌ [WARNING] No EOD data found whatsoever!`);
            } else {
                const latest = eodSnap.docs[0].data();
                console.log(`    ✅ Latest EOD: ${latest.date} ($${latest.close}) Provider: ${latest.provider}`);
            }
        }
    }

    if (optionCount === 0) {
        console.log('✅ No active option positions found.');
    } else {
        console.log(`\nFound ${optionCount} active options.`);
    }
}

listActiveOptions().catch(console.error);
