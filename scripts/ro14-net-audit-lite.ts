
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import {
    getEffectiveTradingDay,
    getPeriodBaseDates,
    prevNyTradingDayString
} from '../src/lib/ny-time';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

const logFile = 'ro14_net_audit_lite.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-14: 'NET' Missing EOD Audit (Lite) ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NET";
    const now = new Date();
    const asOfDayNy = getEffectiveTradingDay(now);
    const baseDates = getPeriodBaseDates(asOfDayNy);
    const ytdAnchorDayNy = baseDates.ytd;
    const refDayNy = prevNyTradingDayString(asOfDayNy);

    log(`\n--- E1. Ticker & Date Context ---`);
    log(`Symbol: ${symbol}`);
    log(`asOfDayNy: ${asOfDayNy}`);
    log(`ytdAnchorDayNy: ${ytdAnchorDayNy}`);
    log(`refDayNy: ${refDayNy}`);

    const ids = [
        { label: "Today", id: `${asOfDayNy}_${symbol}` },
        { label: "YTD Anchor", id: `${ytdAnchorDayNy}_${symbol}` },
        { label: "Ref Day", id: `${refDayNy}_${symbol}` }
    ];

    log(`\n--- E3. Firestore Persistence Verification (Public Reads) ---`);
    for (const item of ids) {
        log(`\nChecking [${item.label}] ID: ${item.id}`);
        try {
            const closeRef = doc(db, 'officialCloses', item.id);
            const closeSnap = await getDoc(closeRef);
            if (closeSnap.exists()) {
                const d = closeSnap.data();
                log(`- officialCloses: EXISTS | status: ${d.status} | close: ${d.close} | provider: ${d.provider}`);
            } else {
                log(`- officialCloses: MISSING`);
            }
        } catch (e: any) {
            log(`- officialCloses: ERROR (${e.message})`);
        }
    }

    log(`\nChecking stockDetails/${symbol}:`);
    try {
        const detailRef = doc(db, 'stockDetails', symbol);
        const detailSnap = await getDoc(detailRef);
        if (detailSnap.exists()) {
            const dd = detailSnap.data();
            log(`- eodRevision: ${dd.eodRevision || 0}`);
        } else {
            log(`- stockDetails: MISSING`);
        }
    } catch (e: any) {
        log(`- stockDetails: ERROR (${e.message})`);
    }

    log("\n--- E5. Decision ---");
    log("A) 真缺数据: If YTD Anchor missing.");
    log("B) 数据已补信号未变: If data exists but revision is low/zero.");
    log("C) 计算口径: If both exist but NET still missing.");
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
