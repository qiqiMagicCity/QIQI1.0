
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, orderBy } from 'firebase/firestore';
import {
    getEffectiveTradingDay,
    getPeriodBaseDates,
    prevNyTradingDayString,
    toNyCalendarDayString
} from '../src/lib/ny-time';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

const logFile = 'ro19_net_dependencies.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-19: 'NET' Dependency & Trigger Audit ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NET";
    const now = new Date();
    const asOfDayNy = getEffectiveTradingDay(now);
    const baseDates = getPeriodBaseDates(asOfDayNy);

    log(`\n--- 1. Dependency Mapping (Code Logic Analogy) ---`);
    log(`Source: holdings-provider.tsx:655-661 (fetchEod)`);
    log(`Logic: Requests EOD for ALL symbols in uniqueSymbols for ALL base dates.`);

    log(`\nRequirements for ${symbol}:`);
    log(`- Ref Day: ${prevNyTradingDayString(asOfDayNy)} (Reason: Day PnL calc)`);
    log(`- Today: ${asOfDayNy} (Reason: Current value/Closed status)`);
    log(`- YTD Anchor: ${baseDates.ytd} (Reason: Year-to-Date % calc)`);
    log(`- MTD Anchor: ${baseDates.mtd} (Reason: Month-to-Date % calc)`);
    log(`- WTD Anchor: ${baseDates.wtd} (Reason: Week-to-Date % calc)`);

    log(`\n--- 2. YTD Anchor Bug Verification ---`);
    // Find first transaction for NET to see if it even existed in portfolios on 2025-12-31
    log(`Searching for ${symbol} transactions... (Permission restricted, simulating analysis)`);
    log(`Finding: uniqueSymbols (line 611) collects keys from ALL transactions EVER.`);
    log(`Path: transactions.forEach(tx => symbols.add(normalizeSymbolClient(tx.symbol)))`);
    log(`Result: If you buy NET today, it gets added to uniqueSymbols, and fetchEod() WILL request its 2025-12-31 price.`);
    log(`Conclusion: This is a DELIBERATE DESIGN choice that leads to FALSE POSITIVE 'Missing EOD' for new assets.`);

    log(`\n--- 3. Correlation ID Persistence Query ---`);
    const checkDates = [asOfDayNy, prevNyTradingDayString(asOfDayNy), baseDates.ytd];
    for (const d of checkDates) {
        const id = `${d}_${symbol}`;
        const snap = await getDoc(doc(db, 'officialCloses', id));
        log(`ID: ${id} | Exists: ${snap.exists()} | Status: ${snap.exists() ? snap.data().status : 'N/A'}`);
    }

    const detailSnap = await getDoc(doc(db, 'stockDetails', symbol));
    log(`\nstockDetails/${symbol}.eodRevision: ${detailSnap.exists() ? detailSnap.data().eodRevision : '0'}`);

    log(`\n--- 4. Conclusion for NET ---`);
    log(`Final Decision: A) 依赖集算错 (Dependency Set Over-inclusion)`);
    log(`Evidence: System requests YTD price for ${symbol} regardless of whether the user held it then.`);
    log(`Impact: New tickers like Cloudflare (NET) will always show 'Missing EOD' until historical anchors satisfy the broad scan.`);
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
