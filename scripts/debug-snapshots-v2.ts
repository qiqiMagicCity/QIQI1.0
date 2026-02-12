
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function checkSnapshots() {
    console.log('🔍 Checking `snapshots` collection (limit 3) for targeted options...');

    // Scan all users snapshots
    // Since we don't know the exact user ID from the user info, we list all users again.
    const userRefs = await db.collection('users').listDocuments();
    let found = false;

    // We look for these symbols in the inventory
    const targets = ['GOOG', 'NVO', 'NIO', 'AAPL'];

    for (const userRef of userRefs) {
        const snapsRef = userRef.collection('snapshots');
        const snaps = await snapsRef.orderBy('date', 'desc').limit(3).get();
        if (snaps.empty) continue;

        console.log(`\nUser: ${userRef.id}`);

        snaps.forEach(doc => {
            const data = doc.data();
            console.log(`  Snapshot: ${data.date} (Version: ${data.version})`);

            if (data.inventory) {
                let hasGhost = false;
                Object.keys(data.inventory).forEach(key => {
                    // Check if key matches targets
                    // Key format usually: SYMBOL or SYMBOL-RIGHT-STRIKE-...
                    const k = key.toUpperCase();
                    if (targets.some(t => k.includes(t))) {
                        // Further filter for option-like keys
                        if (k.length > 6 || k.includes('26')) {
                            hasGhost = true;
                            console.log(`    ✅ Found Inventory Key: ${key}`);
                            // console.log(`       Lots: ${JSON.stringify(data.inventory[key])}`);
                        }
                    }
                });

                if (hasGhost) {
                    found = true;
                    console.log('    --> This snapshot contains the missing options!');
                }
            } else {
                console.log('    (No inventory field)');
            }
        });
    }

    if (!found) {
        console.log('❌ No matching option inventory found in snapshots either.');
    } else {
        console.log('✅ Confirmed: The missing options exist in `snapshots` inventory, but NOT in `transactions` collection.');
    }
}

checkSnapshots().catch(console.error);
