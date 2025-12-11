
import * as admin from 'firebase-admin';
// import yahooFinance from 'yahoo-finance2'; // Not needed for pure report

// 1. Initialize Firebase
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Helpers
function getDayString(ts: number): string {
    const d = new Date(ts);
    return d.toISOString().split('T')[0];
}

async function main() {
    process.stdout.write('🕵️ STARTING SABOTEUR HUNT (REPORT ONLY)...\n');

    const SUSPECT_DATES = new Set(['2025-10-22', '2025-10-23', '2025-10-24', '2025-10-27']);
    const foundSymbols = new Set<string>();

    const users = await db.collection('users').listDocuments();
    for (const user of users) {
        // console.log(`Scanning user: ${user.id}...`);
        const snap = await user.collection('transactions').get();
        if (snap.empty) continue;

        snap.forEach(doc => {
            try {
                const data = doc.data();
                if (!data) return;

                let dateStr = '';
                if (data.transactionTimestamp) {
                    try {
                        dateStr = getDayString(data.transactionTimestamp);
                    } catch (e) {
                        // ignore
                    }
                }

                if (dateStr && SUSPECT_DATES.has(dateStr)) {
                    const s = data.symbol;
                    if (s) foundSymbols.add(s.toUpperCase().trim());
                }
            } catch (err) { }
        });
    }

    const candidates = Array.from(foundSymbols).sort();
    console.log(`🔎 Checking ${candidates.length} candidate symbols: ${candidates.join(', ')}`);

    const saboteurs: string[] = [];

    for (const sym of candidates) {
        const docId = `2025-10-22_${sym}`;
        const doc = await db.collection('officialCloses').doc(docId).get();

        let looksBad = false;
        if (!doc.exists) looksBad = true;
        else {
            const d = doc.data();
            if (d?.status !== 'ok' || !d.close) looksBad = true;
        }

        if (looksBad) {
            saboteurs.push(sym);
        }
    }

    if (saboteurs.length === 0) {
        console.log('✅ STRANGE... No missing data found for ANY candidate symbol on Oct 22.');
    } else {
        console.log(`\n👮 HUNT COMPLETE. Caught ${saboteurs.length} saboteurs.`);
        console.log('--- THE LIST ---');
        saboteurs.forEach(s => console.log(s));
        console.log('----------------');
    }

    process.exit(0);
}

main();
