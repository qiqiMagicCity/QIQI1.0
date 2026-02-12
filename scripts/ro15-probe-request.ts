
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

async function probe() {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const correlationId = "2026-02-10_NET";
    const reqRef = doc(db, 'meta', 'backfill', 'requests', correlationId);

    console.log(`=== Probing Request: ${correlationId} ===`);
    try {
        const snap = await getDoc(reqRef);
        if (snap.exists()) {
            console.log("Document Found:");
            console.log(JSON.stringify(snap.data(), null, 2));
        } else {
            console.log("Document NOT FOUND in meta/backfill/requests.");
        }
    } catch (e: any) {
        console.error("Error fetching request doc:", e.message);
    }
}

probe();
