import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function checkLatestActivity() {
    const db = admin.firestore();
    console.log('\n🕵️ CHECKING LATEST ACTIVITY (Last 50 requests)\n');

    // Order by updatedAt desc
    const q = await db.collection('meta/backfill/requests')
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get();

    if (q.empty) {
        console.log('❌ No requests found at all.');
    } else {
        console.log(`✅ Found ${q.size} recent requests.`);

        let todayCount = 0;
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Local time approx

        q.docs.forEach((d, i) => {
            const data = d.data();
            const updated = data.updatedAt?.toDate();

            if (updated > startOfToday) todayCount++;

            if (i < 5) {
                console.log(`   [${d.id}] Status: ${data.status} | Updated: ${updated} | Date: ${data.date}`);
            }
        });

        console.log(`\n📊 Count from Today: ${todayCount}`);

        if (todayCount === 0) {
            console.log('\n❌ CONCLUSION: No writes detected today. The Rebuild function IS NOT writing to DB.');
        } else {
            console.log('\n✅ CONCLUSION: Writes detected. The DB part is working.');
            // If writes detected, check if they are stuck in queued
            const queued = q.docs.filter(d => d.data().status === 'queued').length;
            console.log(`   Pending (Queued): ${queued}`);
        }
    }

    process.exit(0);
}

checkLatestActivity();
