
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== DEEP DIAGNOSTIC: NVO 15.00 MYSTERY ===");

    // 1. Check User Holdings (Manual Override?)
    const usersSnap = await db.collection('users').get();
    console.log(`Scanning ${usersSnap.size} users...`);

    for (const userDoc of usersSnap.docs) {
        // Check subcollection
        const holdingsSnap = await userDoc.ref.collection('holdings').get();
        console.log(`   User ${userDoc.id}: ${holdingsSnap.size} holdings`);

        holdingsSnap.forEach(doc => {
            const sym = doc.id;
            // console.log(`      Checking ${sym}...`);
            if (sym.includes('NVO') || (doc.data().symbol && doc.data().symbol.includes('NVO'))) {
                console.log(`\n[User ${userDoc.id}] Holding Doc: ${doc.id}`);
                console.log(JSON.stringify(doc.data(), null, 2));

                if (doc.data().manualMarkPrice === 15) {
                    console.error("🚨 FOUND THE 15.00! It is still in 'manualMarkPrice'!");
                }
            }
        });
    }

    // 2. Check Official Closes (Is there a stuck close?)
    console.log("\n[Checking Official Closes for NVO...]");
    const closeSnap = await db.collection('officialCloses').get();
    closeSnap.forEach(doc => {
        if (doc.id.includes('NVO')) {
            const d = doc.data();
            // Check for values close to 15
            if (Math.abs(d.close - 15) < 0.1) {
                console.error(`🚨 FOUND THE 15.00 in OfficialCloses! ID: ${doc.id}`);
                console.log(JSON.stringify(d, null, 2));
            }
            // Log today's records
            if (doc.id.includes('2026-02-06')) {
                console.log(`[Today's Close] ${doc.id}: ${d.close} (${d.provider})`);
            }
        }
    });

    console.log("\n=== Done ===");
}

main();
