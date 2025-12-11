
import * as admin from 'firebase-admin';

// Initialize Firebase
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

const TARGET_DATES = ['2025-10-22', '2025-10-23', '2025-10-24', '2025-10-27'];

async function getUniqueSymbols(): Promise<string[]> {
    // console.log('Scanning users for symbols...'); // Silent
    const users = await db.collection('users').listDocuments();
    const symbols = new Set<string>();

    for (const user of users) {
        const txs = await user.collection('transactions').get();
        txs.forEach(doc => {
            const s = doc.data().symbol;
            if (s && typeof s === 'string' && s.length < 10) {
                symbols.add(s.toUpperCase().trim());
            }
        });
    }
    return Array.from(symbols).sort();
}

async function diagnoseStrict() {
    process.stdout.write('STARTING STRICT DIAGNOSIS...\n');

    const symbols = await getUniqueSymbols();
    process.stdout.write(`Checked ${symbols.length} symbols against 4 target dates.\n`);

    const tasks: { sym: string, date: string }[] = [];
    symbols.forEach(sym => {
        TARGET_DATES.forEach(date => tasks.push({ sym, date }));
    });

    let issueCount = 0;

    // Process in parallel roughly
    const CONCURRENCY = 50;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const chunk = tasks.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (t) => {
            const docId = `${t.date}_${t.sym}`;
            const snap = await db.collection('officialCloses').doc(docId).get();

            let reason = '';
            let isBad = false;

            if (!snap.exists) {
                isBad = true;
                reason = 'DocNotFound';
            } else {
                const data = snap.data();
                if (data?.status !== 'ok') {
                    isBad = true;
                    reason = `Status:${data?.status}`;
                } else if (typeof data.close !== 'number' || data.close <= 0) {
                    isBad = true;
                    reason = `CloseInvalid:${data.close}`;
                }
            }

            if (isBad) {
                console.log(`[MISSING] Symbol: ${t.sym}, Date: ${t.date}, Reason: ${reason}`);
                issueCount++;
            }
        }));
    }

    if (issueCount === 0) {
        process.stdout.write('✅ PERFECT. No gaps found in strict mode.\n');
    } else {
        process.stdout.write(`❌ FOUND ${issueCount} ISSUES.\n`);
    }

    setTimeout(() => process.exit(0), 1000); // Give logger time to flush
}

diagnoseStrict();
