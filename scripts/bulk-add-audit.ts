
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, writeBatch, increment, serverTimestamp } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

async function runAudit() {
    const logFile = 'audit_results.log';
    const log = (msg: string) => {
        console.log(msg);
        fs.appendFileSync(logFile, msg + '\n');
    };

    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

    log("=== [AUDIT] Bulk Add Permission & Path Boundary Evidence ===");
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    log("\n--- Evidence E1: Connection Info ---");
    log(`Firebase Project ID: ${firebaseConfig.projectId}`);
    const { user } = await signInAnonymously(auth);
    log(`Current User UID: ${user.uid}`);
    log(`Firestore Host Type: PRODUCTION_GOOGLE_APIS`);

    log("\n--- Evidence E3: Minimal Separated Probes ---");

    log("Probe-A: Create one transaction doc...");
    const txId = "probe-tx-" + Date.now();
    const txRef = doc(db, 'users', user.uid, 'transactions', txId);
    try {
        await setDoc(txRef, { symbol: 'AUDIT', qty: 1, price: 10, userId: user.uid });
        log("✅ Probe-A (Transactions) RESULT: ALLOWED");
    } catch (e: any) {
        log(`❌ Probe-A (Transactions) RESULT: DENIED [${e.code}] ${e.message}`);
    }

    log("\nProbe-B: Update users/{uid} txRevision...");
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, { id: user.uid, name: "Audit User", txRevision: 0 }, { merge: true });

    try {
        await updateDoc(userRef, {
            txRevision: increment(1),
            updatedAt: serverTimestamp()
        });
        log("✅ Probe-B (User Update) RESULT: ALLOWED");
    } catch (e: any) {
        log(`❌ Probe-B (User Update) RESULT: DENIED [${e.code}] ${e.message}`);
    }

    log("\n--- Evidence E2: Batch Operation List (Simulation) ---");
    const testBatch = [
        { op: 'SET', path: `users/${user.uid}/transactions/new-tx-1`, keys: ['symbol', 'qty', 'price', 'userId'] },
        { op: 'SET', path: `users/${user.uid}/transactions/new-tx-2`, keys: ['symbol', 'qty', 'price', 'userId'] },
        { op: 'UPDATE', path: `users/${user.uid}`, keys: ['txRevision', 'updatedAt'] },
        { op: 'DELETE', path: `pnlSnapshots/${user.uid}/months/2026-02`, keys: [] }
    ];
    testBatch.forEach((item, idx) => {
        log(`${idx + 1}. [${item.op}] PATH: ${item.path} | KEYS: [${item.keys.join(', ')}]`);
    });

    log("\n[Security Check] Attempting to write isAdmin: true via updateDoc...");
    try {
        await updateDoc(userRef, { isAdmin: true });
        log("❌ CRITICAL: Environment allows isAdmin write! Security rules are not yet robust.");
    } catch (e: any) {
        log(`✅ SUCCESS: isAdmin WRITE DENIED as expected. [${e.code}]`);
    }
}

runAudit().catch(console.error);
