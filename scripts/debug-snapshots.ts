
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function debugSnapshots() {
    console.log('🔍 Checking `snapshots` collection for option inventory...');

    // Scan all users snapshots
    const userRefs = await db.collection('users').listDocuments();
    let found = false;

    for (const userRef of userRefs) {
        const snapsRef = userRef.collection('snapshots');
        const snaps = await snapsRef.orderBy('date', 'desc').limit(3).get();

        if (snaps.empty) continue;

        console.log(`\nUser: ${userRef.id} - Checking recent snapshots...`);

        snaps.forEach(doc => {
            const data = doc.data();
            console.log(`Snapshot Date: ${data.date}`);

            if (data.inventory) {
                // Check if inventory keys contain our options
                Object.keys(data.inventory).forEach(key => {
                    const k = key.toUpperCase();
                    if (k.includes('GOOG') || k.includes('NVO') || k.includes('NIO') || k.includes('AAPL')) {
                        // Double check if it looks like an option key or just stock
                        if (k.length > 6 || k.includes('26')) { // rough heuristic
                            console.log(`   ✅ Found Inventory Key: ${key}`);
                            console.log(`      Lots: ${JSON.stringify(data.inventory[key])}`);
                            found = true;
                        }
                    }
                });
            }
        });
    }

    if (!found) {
        console.log('❌ No option inventory found in snapshots.');
    }
}

debugSnapshots().catch(console.error);
