
import { initializeFirebase } from '../src/firebase/index';
import { triggerManualBackfill, getOfficialCloses } from '../src/lib/data/official-close-repo';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

async function debugBackfill() {
    console.log("Initializing...");
    initializeFirebase();
    const db = getFirestore();

    const scenarios = [
        { date: '2025-10-03', symbol: 'TSLQ' },
        { date: '2025-10-06', symbol: 'APP' }
    ];

    for (const s of scenarios) {
        const key = `${s.date}_${s.symbol}`;
        console.log(`\n--- Debugging ${key} ---`);

        // 1. Check Firestore
        const docRef = doc(db, 'officialCloses', key);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            console.log("Firestore Data:", snap.data());
        } else {
            console.log("Firestore: Document does NOT exist.");
        }

        // 2. Trigger Backfill
        console.log("Triggering Backfill...");
        try {
            await triggerManualBackfill(s.date, [s.symbol], true);
            console.log("Backfill triggered successfully.");
        } catch (e) {
            console.error("Backfill Error:", e);
        }

        // 3. Wait a bit
        console.log("Waiting 5s...");
        await new Promise(r => setTimeout(r, 5000));

        // 4. Check Firestore Again
        const snap2 = await getDoc(docRef);
        if (snap2.exists()) {
            console.log("Firestore Data After:", snap2.data());
        } else {
            console.log("Firestore: Still does NOT exist.");
        }
    }
}

debugBackfill().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
