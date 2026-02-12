
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

async function audit() {
    console.log("=== [RO-21] NET Backfill Request Status Audit ===");
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const symbol = "NET";
    const date = "2026-02-10";
    const docId = `${date}_${symbol}`;

    // 1. officialCloses
    console.log(`\n1. [officialCloses/${docId}]`);
    try {
        const snap = await getDoc(doc(db, 'officialCloses', docId));
        if (snap.exists()) {
            const data = snap.data();
            console.log(`EXISTS | status: ${data.status} | close: ${data.close} | provider: ${data.provider}`);
        } else {
            console.log("MISSING");
        }
    } catch (e: any) {
        console.log(`ERROR: ${e.message}`);
    }

    // 2. meta/backfill/requests
    console.log(`\n2. [meta/backfill/requests/${docId}]`);
    try {
        const snap = await getDoc(doc(db, 'meta', 'backfill', 'requests', docId));
        if (snap.exists()) {
            const data = snap.data();
            console.log(`EXISTS | status: ${data.status}`);
            if (data.provider) console.log(`provider: ${data.provider}`);
            if (data.attempts) console.log(`attempts: ${data.attempts}`);
            if (data.error) console.log(`error: ${data.error}`);
        } else {
            console.log("MISSING");
        }
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            console.log("ERROR: permission-denied (读不到)");
            console.log("\n[ACTION REQUIRED] 请使用 Firebase CLI 拉取云函数日志进行穿透排查：");
            console.log(`命令: firebase functions:log --only backfillWorker | grep "${docId}"`);
            console.log(`或者: firebase functions:log --only requestBackfillEod | grep "${docId}"`);
        } else {
            console.log(`ERROR: ${e.message}`);
        }
    }

    // 3. stockDetails
    console.log(`\n3. [stockDetails/${symbol}]`);
    try {
        const snap = await getDoc(doc(db, 'stockDetails', symbol));
        if (snap.exists()) {
            const data = snap.data();
            let updateTime = 'N/A';
            if (data.updatedAt) {
                if (typeof data.updatedAt.toDate === 'function') updateTime = data.updatedAt.toDate().toISOString();
                else if (data.updatedAt.seconds) updateTime = new Date(data.updatedAt.seconds * 1000).toISOString();
                else updateTime = JSON.stringify(data.updatedAt);
            }
            console.log(`EXISTS | eodRevision: ${data.eodRevision} | updatedAt: ${updateTime}`);
        } else {
            console.log("MISSING");
        }
    } catch (e: any) {
        console.log(`ERROR: ${e.message}`);
    }
}

audit().catch(err => console.error("Audit fatal error:", err));
