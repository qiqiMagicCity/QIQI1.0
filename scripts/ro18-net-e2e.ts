
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

const logFile = 'ro18_net_e2e.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-18: 'NET' E2E Linkage Audit ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NET";
    // We target the two likely dates causing the "Spinning/Missing" state
    const dates = ["2026-02-11", "2026-02-10", "2025-12-31"];

    for (const date of dates) {
        const correlationId = `${date}_${symbol}`;
        log(`\n--- Probing CorrelationId: ${correlationId} ---`);

        // 1. officialCloses
        const closeRef = doc(db, 'officialCloses', correlationId);
        const closeSnap = await getDoc(closeRef);
        if (closeSnap.exists()) {
            const d = closeSnap.data();
            log(`officialCloses: EXISTS | status: ${d.status} | close: ${d.close} | provider: ${d.provider} | updatedAt: ${d.retrievedAt?.toDate()?.toISOString() || 'N/A'}`);
        } else {
            log(`officialCloses: MISSING`);
        }

        // 2. meta/backfill/requests
        const reqRef = doc(db, 'meta', 'backfill', 'requests', correlationId);
        const reqSnap = await getDoc(reqRef);
        if (reqSnap.exists()) {
            const rd = reqSnap.data();
            log(`meta/backfill/requests: EXISTS | status: ${rd.status} | retryCount: ${rd.retryCount || 0} | lastError: ${rd.error || 'None'} | updatedAt: ${rd.updatedAt?.toDate()?.toISOString() || 'N/A'}`);
        } else {
            log(`meta/backfill/requests: MISSING`);
        }
    }

    log(`\n--- Signal Probe: stockDetails/${symbol} ---`);
    const detailRef = doc(db, 'stockDetails', symbol);
    const detailSnap = await getDoc(detailRef);
    if (detailSnap.exists()) {
        const d = detailSnap.data();
        log(`eodRevision: ${d.eodRevision || 0} | lastUpdated: ${d.updatedAt?.toDate()?.toISOString() || 'N/A'}`);
    } else {
        log(`stockDetails: MISSING`);
    }

    log("\n--- Frontend Logic Trace (Static Analysis) ---");
    log("1. attemptCount Logic: holdings-provider.tsx uses 'attemptedBackfillsRef' with 5m TTL.");
    log("2. isQueued Refresh: holdings-provider.tsx line 876 has NO setLastBackfillTs update.");
    log("3. Result: If backend is 'done', frontend has NO signal to re-fetch until the 5m TTL expires or user refreshes.");
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
