
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

const logFile = 'ro15_evidence.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-15: AutoHeal Closed-Loop Audit ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NVDA";
    const date = "2026-02-10";
    const correlationId = `${date}_${symbol}`;

    log(`--- B. Backend Success (Sample: ${correlationId}) ---`);
    const closeRef = doc(db, 'officialCloses', correlationId);
    const closeSnap = await getDoc(closeRef);

    if (closeSnap.exists()) {
        const d = closeSnap.data();
        log(`OfficialClose found: YES | Status: ${d.status} | Close: ${d.close} | Provider: ${d.provider}`);
        log(`Raw retrievedAt: ${JSON.stringify(d.retrievedAt)}`);
    } else {
        log(`OfficialClose found: NO for ${correlationId}`);
    }

    log("\n--- C. Completion Signal Presence ---");
    const detailRef = doc(db, 'stockDetails', symbol);
    const detailSnap = await getDoc(detailRef);
    if (detailSnap.exists()) {
        const d = detailSnap.data();
        log(`${symbol} eodRevision: ${d.eodRevision || '0'}`);
    }

    log("\n--- D. Signal Path Analysis ---");
    log("1. Backend Completion: Worker writes doc to officialCloses.");
    log("2. Signal Defect: Backend DOES NOT update any reactive field (eodRevision/lastBackfillAt).");
    log("3. Frontend Defect: HoldingsProvider only updates lastBackfillTs on direct success, NOT background success.");
    log("   - Line 843 in holdings-provider.tsx: if (isQueued) { // No lastBackfillTs update here }");
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
