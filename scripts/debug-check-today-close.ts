
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== Checking Official Closes for NVO (Today: 2026-02-06) ===");

    // Check both potential symbol formats
    const symbols = ['NVO261218C50', 'NVO261218C00050000'];
    const date = '2026-02-06';

    for (const sym of symbols) {
        const id = `${date}_${sym}`;
        const doc = await db.collection('officialCloses').doc(id).get();
        if (doc.exists) {
            console.log(`[FOUND] Official Close for Today (${date})!`);
            console.log(`   ID: ${doc.id}`);
            console.log(`   Data:`, doc.data());
            console.log(`   >> This entry forces the UI to show this price instead of Real-Time.`);
            console.log(`   >> Deleting...`);
            await doc.ref.delete();
            console.log(`   >> Deleted.`);
        } else {
            console.log(`[Clean] No official close found for ${id}`);
        }
    }
    console.log("=== Done ===");
}

main();
