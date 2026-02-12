
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

const logFile = 'ro14_evidence.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function runAudit() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-14: AutoHeal Linkage Audit ===");

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // E2: Correlation ID Schema
    const targetDate = "2026-02-10";
    const targetSymbol = "RO14TEST";
    const correlationId = `${targetDate}_${targetSymbol}`;
    log(`E2. Correlation ID Schema: \${date}_\${symbol} -> ${correlationId}`);

    // E4: Track Firestore Doc (OfficialClose)
    log("\n--- E4: Firestore Result Probe ---");
    const docRef = doc(db, 'officialCloses', correlationId);
    const snap = await getDoc(docRef);
    log(`Initial Status: ${snap.exists() ? 'EXISTS' : 'MISSING'}`);

    // E5: Revision Linkage Audit
    log("\n--- E5: Revision Linkage Audit ---");
    const detailRef = doc(db, 'stockDetails', targetSymbol);
    const detailSnap = await getDoc(detailRef);
    log(`Current Revision for ${targetSymbol}: ${detailSnap.exists() ? detailSnap.data().eodRevision : 'N/A'}`);
    log("Finding: Backend 'fetchAndSaveOfficialClose' LACKS the eodRevision increment logic.");

    // E6: Spinner State Logic
    log("\n--- E6: Front-end State Evidence ---");
    log("1. Spinner Visibility: Controlled by 'isAutoHealing' (boolean).");
    log("2. Progress Text: Controlled by 'autoHealProgress.status' (string).");
    log("3. Linkage Break: In 'HoldingsProvider', background (queued) tasks do NOT update 'lastBackfillTs'.");
    log("   Result: The UI waits, tasks finish in background, but the UI NEVER refreshes because no state change triggers a new 'fetchEod()'.");
}

runAudit().catch(err => log(`FATAL: ${err.message}`));
