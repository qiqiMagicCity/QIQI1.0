import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function checkDead() {
    const db = admin.firestore();
    console.log('--- DIAGNOSIS START ---');

    // 1. Check if ANY requests exist for Oct 2025
    console.log('Checking for ANY Oct 2025 requests...');
    const q = await db.collection('meta/backfill/requests')
        .where('date', '>=', '2025-10-01')
        .where('date', '<=', '2025-10-31')
        .limit(20)
        .get();

    if (q.empty) {
        console.log('❌ CRITICAL: No requests found for Oct 2025.');
        console.log('   This means rebuildHistoricalEod DID NOT SAVE the requests to Firestore.');
        console.log('   Possible cause: The function timed out or crashed BEFORE batch.commit().');
    } else {
        console.log(`✅ Found ${q.size} requests. Checking status...`);
        q.forEach(d => {
            console.log(`   [${d.id}] Status: ${d.data().status} (Updated: ${d.data().updatedAt?.toDate()})`);
        });
    }

    console.log('--- DIAGNOSIS END ---');
    process.exit(0);
}

checkDead();
