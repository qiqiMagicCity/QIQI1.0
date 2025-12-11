import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function checkSpecificRequests() {
    const db = admin.firestore();

    const targetIds = [
        "2025-01-09_GGLL", "2025-01-09_UMAC", "2025-01-09_SMCI", "2025-01-09_NVDL",
        "2025-03-27_CRWV", "2025-01-09_NVO", "2025-01-09_CRM", "2025-01-09_OKLO",
        "2025-01-09_TSLL", "2025-01-09_TSDD", "2025-01-09_NUE", "2025-01-09_USO",
        "2025-01-09_MRVL", "2025-01-09_GSAT", "2025-01-09_QCOM", "2025-01-09_PHG",
        "2025-01-09_KBWB", "2025-01-09_FI", "2025-01-09_WBD", "2025-01-09_IBKR",
        "2025-01-09_FFIV", "2025-01-09_PAAS", "2025-01-09_TXN", "2025-01-09_MCHP",
        "2025-01-09_SCHW"
    ];

    console.log('\n🔍 Checking 25 Specific Backfill Requests...\n');

    // Check requests status
    console.log('📋 Request Status in meta/backfill/requests:');
    const statusMap: Record<string, any> = {};

    for (const id of targetIds) {
        const doc = await db.collection('meta/backfill/requests').doc(id).get();
        if (doc.exists) {
            const data = doc.data()!;
            statusMap[id] = data.status;
            if (data.status !== 'done') {
                console.log(`  ${id}: ${data.status} ${data.error ? `(${data.error})` : ''}`);
            }
        } else {
            console.log(`  ${id}: NOT FOUND in requests`);
        }
    }

    // Check officialCloses
    console.log('\n📊 Existence in officialCloses:');
    let foundCount = 0;
    for (const id of targetIds) {
        const doc = await db.collection('officialCloses').doc(id).get();
        if (doc.exists) {
            foundCount++;
        } else {
            console.log(`  ${id}: MISSING in officialCloses`);
        }
    }

    console.log(`\n✅ Found ${foundCount} / ${targetIds.length} in officialCloses`);

    // Summary
    const statusCount: Record<string, number> = {};
    Object.values(statusMap).forEach(status => {
        statusCount[status] = (statusCount[status] || 0) + 1;
    });

    console.log('\n📈 Request Status Summary:');
    Object.entries(statusCount).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
    });

    process.exit(0);
}

checkSpecificRequests();
