
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function runFrontEndAudit() {
    const targetDate = '2026-01-02';
    const auditSymbols = ['MSFT', 'AAPL', 'NVDA', 'NKE260109C65'];

    console.log('--- [Step 4 Audit] Front-end Consistency 取证 ---');

    // 4) DB Reconciliation (Admin SDK Equivalent)
    console.log('\n[4] Database Check (officialCloses):');
    const eodMap: any = {};
    for (const sym of auditSymbols) {
        const id = `${targetDate}_${sym}`;
        const snap = await getDoc(doc(db, 'officialCloses', id));
        if (snap.exists()) {
            const data = snap.data();
            console.log(` - ${id}: EXISTS (status: ${data.status}, close: ${data.close})`);
            eodMap[id] = data;
        } else {
            console.log(` - ${id}: NOT FOUND`);
        }
    }

    // 2) DailyPnlResult for 2026-01-02
    console.log('\n[2] Runtime DailyPnlResult (2026-01-02):');
    // We simulate the transaction list to see how the engine processes it with real DB data
    const mockTxs: any[] = auditSymbols.map(s => ({
        symbol: s, qty: 1, price: 100, transactionTimestamp: new Date('2025-12-25').getTime(),
        side: 'BUY', opKind: 'TRADE', multiplier: s.includes('260') ? 100 : 1
    }));

    // Explicitly disabling console.log from engine for JSON clarity
    const oldLog = console.log;
    console.log = () => { };
    const results = calcM14DailyCalendar(mockTxs, [targetDate], eodMap);
    console.log = oldLog;

    const res20260102 = results[targetDate];
    console.log(JSON.stringify({
        date: res20260102.date,
        status: res20260102.status,
        missingSymbolsCount: res20260102.missingSymbols?.length || 0,
        missingSymbols: res20260102.missingSymbols || []
    }, null, 2));

    // 3) MissingItems Filter & Export
    console.log('\n[3] MissingItems (Missing List) Export:');
    const items: { date: string; symbols: string[] }[] = [];
    Object.values(results).forEach((r) => {
        // Strict filter: status === 'missing_data'
        if (r.status === "missing_data" && r.missingSymbols && r.missingSymbols.length > 0) {
            items.push({ date: r.date, symbols: r.missingSymbols });
        }
    });

    console.log(` - Filter Condition: status === 'missing_data' && missingSymbols.length > 0`);
    console.log(` - Missing Items Count: ${items.length}`);
    if (items.length > 0) {
        console.log(JSON.stringify(items.slice(0, 5), null, 2));
    } else {
        console.log(' [Result] Missing List is EMPTY based on current engine logic.');
    }
}

runFrontEndAudit().catch(console.error);
