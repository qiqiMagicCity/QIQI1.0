
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Oct 1 to Oct 31, 2025
// Trading days estimation (Mon-Fri)
async function verify() {
    process.stdout.write('Checking ALL OCT 2025...\n');
    const days = [];
    for (let d = 1; d <= 31; d++) {
        const date = `2025-10-${String(d).padStart(2, '0')}`;
        const dayOfWeek = new Date(date).getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) days.push(date);
    }

    // Check aggregates
    let missingCount = 0;

    // Check a sample symbol "AAPL" (or whatever exists)
    // Or just check counts per day?
    // Let's check status count per day.

    for (const date of days) {
        const snap = await db.collection('officialCloses')
            .where('tradingDate', '==', date)
            .where('status', '==', 'ok')
            .get();
        process.stdout.write(`${date}: ${snap.size} OK docs\n`);
        if (snap.size < 10) missingCount++; // Arbitrary threshold
    }

    if (missingCount === 0) process.stdout.write('ALL GREEN.\n');
    else process.stdout.write('SOME RED.\n');

    process.exit(0);
}
verify();
