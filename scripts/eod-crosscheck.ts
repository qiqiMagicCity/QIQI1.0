
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

    const checkIds = [
        "2026-02-10_NVDA",
        "2025-12-31_NVDA",
        "2026-02-10_NET",
        "2025-12-31_NET"
    ];

    console.log("=== Consistency Cross-Check ===");
    for (const id of checkIds) {
        const snap = await getDoc(doc(db, 'officialCloses', id));
        if (snap.exists()) {
            console.log(`[OK] ${id}: close=${snap.data().close}`);
        } else {
            console.log(`[MISSING] ${id}`);
        }
    }
}

check();
