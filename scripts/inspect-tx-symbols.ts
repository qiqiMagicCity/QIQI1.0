
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

async function inspectTransactions() {
    const db = getFirestore();
    const targetSymbols = ["GOOGL260918C150", "NVO261218C50", "NIO260618P3.5"];

    console.log("--- Inspecting Transactions for Screenshot Symbols ---");

    // We search across all users (limited to few records)
    const txsRef = db.collectionGroup("transactions");

    for (const sym of targetSymbols) {
        console.log(`Searching for ${sym}...`);
        const q = await txsRef.where("symbol", "==", sym).limit(5).get();
        if (q.empty) {
            console.log(`[${sym}] No transactions found with this exact symbol.`);
            // Try normalized search
            const q2 = await txsRef.where("symbol", "==", sym.toUpperCase()).limit(1).get();
            if (!q2.empty) console.log(`[${sym}] Found with UPPERCASE.`);
        } else {
            const first = q.docs[0].data();
            console.log(`[${sym}] Found! Symbol: ${first.symbol}, contractKey: ${first.contractKey}, assetType: ${first.assetType}`);
        }
    }
}

inspectTransactions().catch(console.error);
