
import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== Scanning for Manual Mark Prices (NVO) ===");

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const holdingsSnap = await db.collection('users').doc(uid).collection('holdings').get();

        for (const doc of holdingsSnap.docs) {
            const data = doc.data();
            const symbol = doc.id;

            // if (doc.id.includes('NVO') || (data.symbol && data.symbol.includes('NVO'))) {
            console.log(`[User ${uid}] Found Holding Doc: ${doc.id}`);
            console.log(JSON.stringify(data, null, 2));
            // }

            // Check if manualMarkPrice is set
            if (data.manualMarkPrice !== undefined) {
                console.log(`[User ${uid}] Found MANUAL PRICE!`);
                console.log(`   ID: ${doc.id}`);
                console.log(`   Symbol Field: ${data.symbol}`);
                console.log(`   Price: ${data.manualMarkPrice}`);

                // If it looks like NVO, delete it
                if (doc.id.includes('NVO') || (data.symbol && data.symbol.includes('NVO'))) {
                    console.log(`   >> MATCHES NVO! Deleting manualMarkPrice field...`);
                    await doc.ref.update({
                        manualMarkPrice: FieldValue.delete()
                    });
                    console.log(`   >> Deleted.`);
                }
            }
        }
    }
    console.log("=== Scan Complete ===");
}

main();
