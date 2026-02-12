
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== Debug GOOGL Option Data ===");
    // Symbol from context: GOOGL260918C150
    // Try both formats just in case
    const symbols = ['GOOGL260918C150', 'GOOGL260918C00150000'];

    console.log("=== Scanning for ANY GOOGL records (ALL TIME) ===");
    const snap = await db.collection('officialCloses').get();
    snap.forEach(doc => {
        if (doc.id.includes('GOOGL')) {
            console.log(`[FOUND MATCH] ID: ${doc.id}`);
            console.log(doc.data());
        }
    });
    console.log("=== Done ===");
}

main();
