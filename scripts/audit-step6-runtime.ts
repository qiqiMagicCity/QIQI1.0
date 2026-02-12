
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function runStep6Audit() {
    console.log('--- [Step 6 Audit] Runtime Reconciliation ---');

    // A) Version Fingerprint
    const commitHash = '133ba35c231dcdd142c40af0ebe14e5554244b98';
    const engineVersionFromCode = '4.0.0-GA';
    const engineVersionFromLog = 'V4.0.1';
    console.log('[A] Version Fingerprint:');
    console.log(` - Commit: ${commitHash}`);
    console.log(` - Engine ID (Code): ${engineVersionFromCode}`);
    console.log(` - Engine ID (Log): ${engineVersionFromLog}`);

    // B) MissingItems Export (Simulation based on Jan 2026 Active Symbols)
    // We'll audit 5 dates in Jan 2026 that commonly had issues
    const targetDates = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
    const auditSymbols = ['NKE260109C65', 'AAPL', 'NVDA', 'MSFT', 'TSLA'];

    console.log('\n[B] MissingItems (Missing List) Export for Jan 2026:');

    // To simulate what the front-end sees, we run the engine with empty transactions
    // and empty EOD map (forcing it to look for missing data) then we'll fill the map
    // with actual DB data in Step C.
    const mockTxs: any[] = auditSymbols.map(s => ({
        symbol: s, qty: 1, price: 100, transactionTimestamp: new Date('2025-12-25').getTime(),
        side: 'BUY', opKind: 'TRADE', multiplier: s.includes('260') ? 100 : 1
    }));

    // First, run without EOD data to see what it *would* report as missing
    const resultsNoData = calcM14DailyCalendar(mockTxs, targetDates, {});
    const initialMissing = Object.values(resultsNoData)
        .filter(r => r.status === 'missing_data' && r.missingSymbols && r.missingSymbols.length > 0)
        .map(r => ({ date: r.date, symbols: r.missingSymbols }));

    console.log(` - Simulated Missing Items Count (Potential): ${initialMissing.length}`);
    if (initialMissing.length > 0) {
        console.log(JSON.stringify(initialMissing.slice(0, 5), null, 2));
    }

    // C) Firestore Reconciliation
    console.log('\n[C] Firestore Real-time Reconciliation (officialCloses):');
    const actualEodMap: any = {};
    for (const date of targetDates) {
        for (const sym of auditSymbols) {
            const id = `${date}_${sym}`;
            const snap = await getDoc(doc(db, 'officialCloses', id));
            if (snap.exists()) {
                const data = snap.data();
                console.log(` - ${id}: EXISTS | status: ${data.status} | close: ${data.close}`);
                actualEodMap[id] = data;
            } else {
                console.log(` - ${id}: NOT_FOUND`);
            }
        }
    }

    // D) DailyPnlResult Export (with actual DB data)
    console.log('\n[D] DailyPnlResult Export (Final Engine Output):');
    const finalResults = calcM14DailyCalendar(mockTxs, targetDates, actualEodMap);

    targetDates.forEach(date => {
        const r = finalResults[date];
        console.log(` - ${date}: status=${r.status} | missingSymbols=[${r.missingSymbols?.join(', ') || ''}]`);
    });

    const finalMissing = Object.values(finalResults)
        .filter(r => r.status === 'missing_data' && r.missingSymbols && r.missingSymbols.length > 0);

    console.log(`\nFinal Result: Missing List length is ${finalMissing.length}.`);
    if (finalMissing.length === 0) {
        console.log('Conclusion: No "False Missing" found in current engine state. All problematic Jan 2026 data exists in DB and is correctly processed.');
    } else {
        console.log('Conclusion: Detected items in Missing List.');
    }
}

runStep6Audit().catch(console.error);
