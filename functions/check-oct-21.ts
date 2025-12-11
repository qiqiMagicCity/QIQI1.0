
import * as admin from 'firebase-admin';

// Initialize Firebase
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

async function check() {
    console.log('--- CHECK OCT 21 ---');
    // Check just one symbol first to see if data exists generally
    const snapshot = await db.collection('officialCloses')
        .where('tradingDate', '==', '2025-10-21')
        .get();

    console.log(`Found ${snapshot.size} docs for 2025-10-21`);

    // Check status distribution
    const statuses: Record<string, number> = {};
    snapshot.forEach(d => {
        const s = d.data().status;
        statuses[s] = (statuses[s] || 0) + 1;
    });
    console.dir(statuses);

    // Check specific user symbols if needed, but aggregate is enough to see if it's a hole.
    process.exit(0);
}
check();
