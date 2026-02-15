
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';
const SNAPSHOT_ID = '2025-08-31';
const DRY_RUN = process.argv.includes('--dry-run');

async function fixSnapshot() {
    console.log(`=== SURGICAL FIX: ABNB SNAPSHOT [${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}] ===`);

    const snapRef = db.doc(`users/${TARGET_UID}/snapshots/${SNAPSHOT_ID}`);
    // Generate unique backup ID
    const backupId = `${SNAPSHOT_ID}_backup_${Date.now()}`;
    const backupRef = db.doc(`users/${TARGET_UID}/snapshots_backup/${backupId}`);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(snapRef);
            if (!doc.exists) {
                console.error("Snapshot document does not exist!");
                return;
            }

            const data = doc.data() || {};
            const inventory = data.inventory || {};

            if (!inventory['ABNB']) {
                console.log("No ABNB inventory found. Nothing to fix.");
                return;
            }

            console.log("Found ABNB Inventory:", JSON.stringify(inventory['ABNB']));

            if (DRY_RUN) {
                console.log(`[DRY RUN] Would backup to: ${backupRef.path}`);
                console.log(`[DRY RUN] Would delete 'inventory.ABNB' from: ${snapRef.path}`);
                return; // Early exit for dry run
            }

            // 1. Backup: Create new doc in backup collection with full data
            console.log(`Backing up to: ${backupRef.path}`);
            t.set(backupRef, data);

            // 2. Surgical Removal
            console.log(`Deleting 'inventory.ABNB' from: ${snapRef.path}`);
            // Firestore update with FieldValue.delete() removes the map key
            t.update(snapRef, {
                'inventory.ABNB': FieldValue.delete()
            });
        });

        if (!DRY_RUN) {
            console.log("Transaction Committed Successfully.");
        } else {
            console.log("Dry run complete. No changes made.");
        }

    } catch (e) {
        console.error("Transaction Failed:", e);
    }
}

fixSnapshot().catch(console.error);
