
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

async function inspectTransactions() {
    console.log("=== Inspecting NKE Transactions ===");
    const snapshot = await db.collection('transactions')
        .where('symbol', '>=', 'NKE')
        .where('symbol', '<=', 'NKE\uf8ff')
        .get();

    if (snapshot.empty) {
        console.log("No NKE transactions found.");
        return;
    }

    snapshot.docs.forEach(doc => {
        const d = doc.data();
        console.log(`ID: ${doc.id}`);
        console.log(`  Date: ${d.date}`);
        console.log(`  Symbol: ${d.symbol}`);
        console.log(`  Type: ${d.type} (Side: ${d.side})`); // assetType?
        console.log(`  Qty: ${d.quantity}`);
        console.log(`  Price: ${d.price}`);
        console.log(`  Amount/Total: ${d.amount ?? d.totalValue}`);
        console.log(`  Raw Data:`, JSON.stringify(d));
        console.log("------------------------------------------------");
    });
}

inspectTransactions();
