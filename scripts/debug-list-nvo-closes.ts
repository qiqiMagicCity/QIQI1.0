
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== Listing ALL Official Closes for NVO ===");

    // Scan all official closes for symbols containing NVO
    const snap = await db.collection('officialCloses').get();

    let count = 0;
    snap.forEach(async (doc) => {
        if (doc.id.includes('NVO')) {
            const d = doc.data();
            console.log(`[${doc.id}] Provider: ${d.provider}, Close: ${d.close}`);
            if (d.provider === 'realtime_snapshot_manual') {
                console.log("   *** FOUND MANUAL ARTIFACT! DELETING... ***");
                await doc.ref.delete();
                console.log("   *** DELETED ***");
            }
            count++;
        }
    });

    if (count === 0) console.log("No NVO records found.");
    console.log("=== Done ===");
}

main();
