
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import {
    getEffectiveTradingDay,
    getPeriodBaseDates,
    toNyCalendarDayString,
    prevNyTradingDayString
} from '../src/lib/ny-time';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

const logFile = 'ro14_net_audit.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-14: 'NET' Missing EOD Audit ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NET";
    const now = new Date(); // 2026-02-11 11:17 AM
    const asOfDayNy = getEffectiveTradingDay(now);
    const baseDates = getPeriodBaseDates(asOfDayNy);
    const ytdAnchorDayNy = baseDates.ytd;
    // Also include ref day (previous trading day) as asOfDay might need it for Day PnL
    const refDayNy = prevNyTradingDayString(asOfDayNy);

    log(`\n--- E1. Ticker & Date Context ---`);
    log(`Symbol: ${symbol} (Cloudflare)`);
    log(`asOfDayNy: ${asOfDayNy} (Current/Today Trading Day)`);
    log(`ytdAnchorDayNy: ${ytdAnchorDayNy} (Year-to-Date Start Base)`);
    log(`refDayNy: ${refDayNy} (Previous Trading Day Close Base)`);

    const correlationIds = [
        { label: "Today/Effective", date: asOfDayNy },
        { label: "YTD Anchor", date: ytdAnchorDayNy },
        { label: "Prev Close Anchor", date: refDayNy }
    ];

    log(`\n--- E2. Correlation ID Mapping ---`);
    correlationIds.forEach(id => {
        log(`${id.label}: \${date}_\${symbol} -> ${id.date}_${symbol}`);
    });

    log(`\n--- E3. Firestore Persistence Verification ---`);
    for (const item of correlationIds) {
        const id = `${item.date}_${symbol}`;
        log(`\nChecking [${item.label}] ID: ${id}`);

        // 1. officialCloses
        const closeRef = doc(db, 'officialCloses', id);
        const closeSnap = await getDoc(closeRef);
        if (closeSnap.exists()) {
            const d = closeSnap.data();
            log(`- officialCloses: EXISTS | status: ${d.status} | close: ${d.close} | provider: ${d.provider} | updatedAt: ${d.retrievedAt?.toDate()?.toISOString() || 'N/A'}`);
        } else {
            log(`- officialCloses: MISSING`);
        }

        // 2. Backfill Requests
        const reqRef = doc(db, 'meta', 'backfill', 'requests', id);
        const reqSnap = await getDoc(reqRef);
        if (reqSnap.exists()) {
            const rd = reqSnap.data();
            log(`- backfillRequest: EXISTS | status: ${rd.status} | updatedAt: ${rd.updatedAt?.toDate()?.toISOString() || 'N/A'}`);
        } else {
            log(`- backfillRequest: MISSING`);
        }
    }

    log(`\nChecking stockDetails/${symbol}:`);
    const detailRef = doc(db, 'stockDetails', symbol);
    const detailSnap = await getDoc(detailRef);
    if (detailSnap.exists()) {
        const dd = detailSnap.data();
        log(`- eodRevision: ${dd.eodRevision || 0}`);
        log(`- updatedAt: ${dd.updatedAt?.toDate()?.toISOString() || 'N/A'}`);
    } else {
        log(`- stockDetails: MISSING`);
    }

    log(`\n--- E4. Signal Sensitivity Analysis (Simulation) ---`);
    log("If officialCloses exists but UI shows missing:");
    log("1. Check if 'eodRevision' has changed recently.");
    log("2. Check for IndexedDB Cache Hits in browser (not script-verifiable).");
    log("Existing Fact: Backfill-Worker (Backend) was fixed in RO-13 to increment eodRevision.");
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
