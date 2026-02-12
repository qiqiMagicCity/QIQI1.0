
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== DATA INTEGRITY CHECK ===");

    // 1. Check for Dirty Data
    const dirtySnap = await db.collection('officialCloses')
        .where('provider', 'in', ['via_tx', 'manual_dirty'])
        .limit(10)
        .get();

    if (dirtySnap.empty) {
        console.log("✅ CLEAN: No dirty 'via_tx' records found (Sample check passed).");
    } else {
        console.log(`❌ DIRTY: Found ${dirtySnap.size} dirty records still!`);
        dirtySnap.forEach(d => console.log(`   - ${d.id}: ${d.data().close}`));
    }

    // 2. Check AAPL latest
    const aaplSnap = await db.collection('officialCloses')
        .where('symbol', '==', 'AAPL')
        .orderBy('date', 'desc')
        .limit(5)
        .get();

    console.log("\nRecent AAPL Data:");
    aaplSnap.forEach(d => {
        const dat = d.data();
        console.log(`   - ${dat.date}: $${dat.close} (${dat.provider})`);
    });

    // 3. Check Option Data (e.g. valid recent option)
    // Need a known option symbol. Let's list one from 'officialCloses' that has 'polygon_massive'.
    const polySnap = await db.collection('officialCloses')
        .where('provider', '==', 'polygon_massive')
        .limit(5)
        .get();

    console.log("\nSample Repaired Data (Polygon Massive):");
    if (polySnap.empty) {
        console.log("   (No records found yet - maybe repair script didn't finish or found no gaps?)");
    } else {
        polySnap.forEach(d => {
            const dat = d.data();
            console.log(`   - ${dat.symbol} on ${dat.date}: $${dat.close}`);
        });
    }
}

main();
