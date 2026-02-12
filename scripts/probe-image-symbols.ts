
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function probeImageSymbols() {
    const db = getFirestore();
    const symbols = [
        "GOOGL260918C150",
        "NVO261218C50",
        "NIO260618P3.5"
    ];
    const date = "2026-02-10";

    console.log(`--- Probing symbols for ${date} ---`);

    for (const symbol of symbols) {
        const docId = `${date}_${symbol.toUpperCase()}`;
        const closeDoc = await db.collection("officialCloses").doc(docId).get();

        if (closeDoc.exists) {
            const data = closeDoc.data();
            console.log(`[${symbol}] Status: ${data?.status} | Provider: ${data?.provider} | Price: ${data?.close} | Error: ${data?.error}`);
        } else {
            console.log(`[${symbol}] Document NOT FOUND in officialCloses.`);
        }

        // Also check stockDetails for revision
        const detailDoc = await db.collection("stockDetails").doc(symbol.toUpperCase()).get();
        console.log(`[${symbol}] stockDetails: eodRevision=${detailDoc.data()?.eodRevision}, updatedAt=${detailDoc.data()?.updatedAt?.toDate()?.toISOString()}`);
    }

    // Check if there are any PubSub messages pending or if the worker log has entries for these
    console.log("\nSearching for any close records for these symbols with 'O:' prefix just in case...");
    for (const symbol of symbols) {
        // We shouldn't have these in DB because CorrelationId uses the original symbol, but let's check.
        // Actually, let's check meta/backfill/requests
        const reqDoc = await db.collection("meta").doc("backfill").collection("requests").doc(`${date}_${symbol.toUpperCase()}`).get();
        if (reqDoc.exists) {
            console.log(`[${symbol}] Backfill Request exists: status=${reqDoc.data()?.status}`);
        } else {
            console.log(`[${symbol}] No active backfill request found.`);
        }
    }
}

probeImageSymbols().catch(console.error);
