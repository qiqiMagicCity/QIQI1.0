
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, writeBatch, increment, serverTimestamp, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
    "messagingSenderId": "7191046993"
};

const logFile = 'ro12b_results.log';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function executeRO12B() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log("=== [EVID] RO-12B: Bulk Add Step-by-Step Probe (Production) ===");

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    const { user } = await signInAnonymously(auth);
    const tokenResult = await user.getIdTokenResult();

    log("\n--- Evidence E1: Environment Context ---");
    log(`Project ID: ${firebaseConfig.projectId}`);
    log(`Current Auth UID: ${user.uid}`);
    log(`Environment: PRODUCTION`);
    log(`Token IssuedAt: ${tokenResult.issuedAtTime}`);
    log(`Claims: ${JSON.stringify(tokenResult.claims)}`);

    const uid = user.uid;
    const userRef = doc(db, 'users', uid);
    const testTxRef = doc(db, 'users', uid, 'transactions', 'PROBE_RO12B_TEST');
    const testTradeRef = doc(db, 'users', uid, 'trades', 'PROBE_RO12B_TEST');
    const testSnapRef = doc(db, 'pnlSnapshots', uid, 'months', '2026-02');

    log("\n--- Evidence E2 & E3: Operation List & Minimal Probes ---");

    const uSnap = await getDoc(userRef);
    log(`[Existence Check] Document users/${uid} exists: ${uSnap.exists()}`);

    const probes = [
        {
            opType: 'SET',
            docPath: testTxRef.path,
            keys: ['symbol', 'price', 'qty', 'userId', 'transactionDateNy'],
            execute: () => setDoc(testTxRef, {
                symbol: 'TSLA', price: 400, qty: 10, userId: uid, transactionDateNy: '2026-02-10'
            })
        },
        {
            opType: 'DELETE',
            docPath: testTradeRef.path,
            keys: [],
            execute: () => deleteDoc(testTradeRef)
        },
        {
            opType: 'UPDATE',
            docPath: userRef.path,
            keys: ['txRevision', 'updatedAt'],
            execute: () => updateDoc(userRef, {
                txRevision: increment(1),
                updatedAt: serverTimestamp()
            })
        },
        {
            opType: 'DELETE',
            docPath: testSnapRef.path,
            keys: [],
            execute: () => deleteDoc(testSnapRef)
        }
    ];

    let firstDenied = null;

    for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        log(`\nProbe ${i + 1}: [${p.opType}] ${p.docPath} (Keys: ${p.keys.join(', ')})`);
        try {
            await p.execute();
            log(`   ✅ RESULT: SUCCESS`);
        } catch (e: any) {
            log(`   ❌ RESULT: DENIED`);
            log(`      Code: ${e.code}`);
            log(`      Message: ${e.message}`);
            if (!firstDenied) firstDenied = { i: i + 1, ...p, err: e };
        }
    }

    log("\n--- Evidence E4: Critical Failure Identification ---");
    if (firstDenied) {
        log(`FIRST DENIED OP: Probe ${firstDenied.i}`);
        log(`OpType: ${firstDenied.opType}`);
        log(`Path: ${firstDenied.docPath}`);
    } else {
        log("All individual probes SUCCESS.");
    }

    log("\n--- 用户视角说明 ---");
    log("本项审计成功锁定第一个失败点。如果 Probe 3 (UPDATE users/{uid}) 失败，说明规则拒绝对不存在的文档执行更新。");
    log("在批量操作中，必须先确保该文档存在，或将 UPDATE 改为 SET(merge: true)。");
}

executeRO12B().catch(err => {
    log(`FATAL ERROR: ${err.message}`);
    process.exit(1);
});
