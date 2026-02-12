
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

async function listRecent() {
    console.log("=== Listing Recent Transactions ===");
    // Order by date descending if possible, or just get all and slice (if small DB)
    // Assuming 'date' field exists and is string YYYY-MM-DD or timestamp

    // Try simple get all limit 20
    const snapshot = await db.collection('transactions').limit(20).get();

    if (snapshot.empty) {
        console.log("Transactions collection is EMPTY.");
        // Try 'users/{uid}/transactions' ? Some apps use subcollections.
        // But usually it's root 'transactions' with userId field.

        // Let's check root collections
        const colls = await db.listCollections();
        console.log("Root Collections:", colls.map(c => c.id).join(', '));
        return;
    }

    snapshot.docs.forEach(doc => {
        const d = doc.data();
        console.log(`ID: ${doc.id}, Symbol: ${d.symbol}, Date: ${d.date}, Amount: ${d.amount}`);
    });
}

listRecent();
