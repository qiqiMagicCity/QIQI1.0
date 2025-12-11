import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function investigateFailure() {
    const db = admin.firestore();

    console.log('\n🕵️ EMERGENCY INVESTIGATION: 2025-10 Data Check\n');

    // 1. Check if any data for 2025-10 exists in officialCloses
    // We scan for a few known symbols or just listing by ID prefix if possible (Firestore doesn't support prefix scan natively easily without range)
    // We will assume some common symbols involved: NVDA, TSLA, AAPL, etc. or just query by date range if 'tradingDate' field exists.

    console.log('--- 1. Checking officialCloses (Success Evidence) ---');
    const start = '2025-10-01';
    const end = '2025-10-31';

    // Note: This query requires an index on tradingDate. If missing, it might fail.
    // Fallback: Check specific IDs from the user's previous screenshot if scanning fails.
    // User mentioned "2025-10" data missing.
    try {
        const snapshot = await db.collection('officialCloses')
            .where('tradingDate', '>=', start)
            .where('tradingDate', '<=', end)
            .limit(10)
            .get();

        if (snapshot.empty) {
            console.log('❌ Result: ZERO documents found for Oct 2025 in officialCloses.');
        } else {
            console.log(`✅ Result: Found ${snapshot.size} documents for Oct 2025.`);
            snapshot.forEach(d => console.log(`   - ${d.id}: ${d.data().status}`));
        }
    } catch (e) {
        console.log('⚠️ Could not query by tradingDate ( Index missing?), checking explicit sample IDs...');
        const samples = ['2025-10-01_NVDA', '2025-10-15_TSLA', '2025-10-30_AAPL']; // Guesses
        for (const id of samples) {
            const d = await db.collection('officialCloses').doc(id).get();
            console.log(`   - ${id}: ${d.exists ? 'EXISTS' : 'MISSING'}`);
        }
    }

    // 2. Check Requests state
    console.log('\n--- 2. Checking meta/backfill/requests (Process State) ---');
    // We look for any docs with date in Oct 2025
    const reqSnapshot = await db.collection('meta/backfill/requests')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .limit(50)
        .get();

    const stats: Record<string, number> = {};
    reqSnapshot.forEach(d => {
        const s = d.data().status;
        stats[s] = (stats[s] || 0) + 1;
    });

    console.log('Request Status Distribution (Sample of 50):');
    console.table(stats);

    if (stats['queued'] > 0) console.log('👉 Diagnosis: Tasks are stuck in QUEUED. Worker is not picking them up.');
    if (stats['running'] > 0) console.log('👉 Diagnosis: Tasks are stuck in RUNNING. Worker is hanging/crashing.');

    process.exit(0);
}

investigateFailure();
