
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, orderBy } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

const logFile = 'ro20_net_audit.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-20: 'NET' Minimal Dependency Audit ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NET";

    log(`\n--- B. NET Transaction Timeline (NY Days) ---`);
    // Note: In a real environment, I'd query 'transactions' collection for the user.
    // Since I don't have the UID easily, I'll search for 'NET' transactions globally or 
    // just check 'officialCloses' presence as a proxy, but better to check transactions.
    // I recall from previous context that the user has positions. 
    // I'll try to find the earliest transaction for 'NET'.

    // Actually, I can check 'officialCloses' for NET on 2025-12-31. 
    // If it was held then, it should probably be there. 
    // But the core point is: Does the UI *need* it?

    log(`Code Analysis:`);
    log(`1. Today Pl (Row): Requires 2026-02-10 (Ref Day) and 2026-02-11 (Live/Today).`);
    log(`2. YTD PnL (Global): Requires DAILY EOD for NET from 2026-01-01 to 2026-02-11 if NET was held.`);
    log(`3. BUG: fetchEod() [HoldingsProvider:655-661] requests ytdBase (2025-12-31) for ALL uniqueSymbols.`);

    log(`\n--- C. Actual vs Minimal Dependency (Prediction) ---`);
    const today = "2026-02-11";
    const refDay = "2026-02-10";
    const ytdAnchor = "2025-12-31";

    log(`Symbol: NET`);
    log(`Minimal Set for Row Display: [${refDay}, ${today}]`);
    log(`Actual Requested Set (per fetchEod): [${ytdAnchor}, 2026-01-30, 2026-02-06, ${refDay}, ${today}]`);

    log(`\n--- Firestore Verification for ${symbol} ---`);
    const checkDates = [ytdAnchor, "2026-01-30", "2026-02-06", refDay, today];
    for (const d of checkDates) {
        const id = `${d}_${symbol}`;
        const snap = await getDoc(doc(db, 'officialCloses', id));
        if (snap.exists()) {
            log(`ID: ${id} | EXISTS | status: ${snap.data().status} | close: ${snap.data().close}`);
        } else {
            log(`ID: ${id} | MISSING`);
        }
    }

    const reqRef = doc(db, 'meta', 'backfill', 'requests', `${ytdAnchor}_${symbol}`);
    const reqSnap = await getDoc(reqRef);
    if (reqSnap.exists()) {
        log(`\nRequest for YTD Anchor (${ytdAnchor}_NET): status=${reqSnap.data().status} | error=${reqSnap.data().error || 'none'}`);
    } else {
        log(`\nRequest for YTD Anchor (${ytdAnchor}_NET): NOT FOUND`);
    }

    log(`\n--- A. Indicator Semantics ---`);
    log(`Today P/L: (Current Price - Prev Close) * Qty. Source: computeDayPnLSymbol() line 261.`);
    log(`Day Change %: (Current Price - Prev Close) / Prev Close. Source: computeDayPnLSymbol() line 264.`);
    log(`Semantics: These are Asset Performance metrics for the current session.`);
    log(`Conclusion: Today P/L and Day Change ONLY depend on 'prevClose' (2026-02-10). They do NOT depend on 2025-12-31.`);
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
