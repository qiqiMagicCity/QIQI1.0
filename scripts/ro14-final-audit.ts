
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
};

async function audit() {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    console.log("=== RO-14: EOD Dependency & Missing Status Audit ===");

    // A. Columns List (From previous view_file analysis of holdings-overview.tsx)
    const columns = [
        "Logo", "Symbol", "Name/Details", "Type", "Last Price", "Holdings (Qty)",
        "Avg Cost", "NCI", "Break Even", "Today P/L", "Day Change %", "Total P/L", "Realized PnL"
    ];
    console.log("\n[A] Displayed Columns in HoldingsOverview:");
    columns.forEach((c, i) => console.log(`${i + 1}. ${c}`));

    // B. Dependency Set for NET (Simulation of current logic)
    const today = "2026-02-11";
    const refDay = "2026-02-10";
    const ytdAnchor = "2025-12-31";

    console.log("\n[B] Theoretical Dependency Set for 'NET' (First trade: 2026-02-10):");
    console.log(`- Today P/L Column: Depends on ${refDay} (Prev Close)`);
    console.log(`- Total P/L Column: Depends on avgCost (FIFO) + Today Price. No EOD. `);
    console.log(`- YTD Summary: Depends on Daily PnL sequence from 2026-01-01 to ${today}.`);
    console.log(`- CURRENT SYSTEM BEHAVIOR (fetchEod): Explicitly requests ${ytdAnchor} for NET.`);

    // C. Missing EOD Determination Condition
    console.log("\n[C] 'Missing EOD' Badge Condition (Code Trace):");
    console.log("Trigger: (todayPlStatus === 'missing-ref-eod' || todayPlStatus === 'missing-today-eod')");
    console.log("Root Cause: prevClose is null/undefined in computeDayPnLSymbol().");
    console.log("Minimal Missing Set to turn row RED: { 2026-02-10 }.");

    // D. AutoHeal/Backend Probe for NET
    console.log("\n[D] Probing Firestore for NET requests/data...");
    const symbol = "NET";
    const ids = [`${refDay}_${symbol}`, `${ytdAnchor}_${symbol}`];

    for (const id of ids) {
        const snap = await getDoc(doc(db, 'officialCloses', id));
        if (snap.exists()) {
            console.log(`[DATA] ${id}: EXISTS (status=${snap.data().status}, close=${snap.data().close})`);
        } else {
            console.log(`[DATA] ${id}: MISSING`);
        }

        const reqSnap = await getDoc(doc(db, 'meta', 'backfill', 'requests', id));
        if (reqSnap.exists()) {
            console.log(`[REQ]  ${id}: status=${reqSnap.data().status}, error=${reqSnap.data().error || 'none'}`);
        } else {
            console.log(`[REQ]  ${id}: NO REQUEST RECORD`);
        }
    }

    const detailSnap = await getDoc(doc(db, 'stockDetails', symbol));
    console.log(`[SIGNAL] stockDetails/${symbol}: eodRevision=${detailSnap.exists() ? detailSnap.data().eodRevision : 'N/A'}`);
}

audit();
