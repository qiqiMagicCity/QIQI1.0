
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

async function check() {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const dates = ["2026-02-10", "2025-12-31"];
    const symbol = "NET";

    console.log("=== [RO-18] Firestore Probe (Public) ===");
    for (const d of dates) {
        const id = `${d}_${symbol}`;
        const snap = await getDoc(doc(db, 'officialCloses', id));
        if (snap.exists()) {
            console.log(`[FOUND] ${id}: status=${snap.data().status}`);
        } else {
            console.log(`[MISSING] ${id}`);
        }
    }

    const detail = await getDoc(doc(db, 'stockDetails', symbol));
    console.log(`stockDetails/${symbol}.eodRevision: ${detail.exists() ? detail.data().eodRevision : 'N/A'}`);
}
check();
