
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

try {
    const serviceAccount = require('../service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
    try { initializeApp(); } catch (e2) { }
}

const db = getFirestore();
const TARGET_UID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function verifyFixAndGetBackup() {
    console.log("=== VERIFICATION & BACKUP RETRIEVAL ===");

    // 1. Check Backup
    const backupCol = db.collection(`users/${TARGET_UID}/snapshots_backup`);
    const backupSnap = await backupCol.orderBy('timestamp', 'desc').get(); // Assuming keys have timestamp or we scan

    // Since IDs are timestamped, we can just list them
    const backups = (await backupCol.listDocuments()).map(d => d.id).filter(id => id.includes('2025-08-31'));

    console.log(`\n[Backups Found]:`);
    for (const backupId of backups) {
        console.log(` - users/${TARGET_UID}/snapshots_backup/${backupId}`);
    }

    // 2. Check Original Snapshot
    const snapRef = db.doc(`users/${TARGET_UID}/snapshots/2025-08-31`);
    const snapDoc = await snapRef.get();

    if (snapDoc.exists) {
        const data = snapDoc.data();
        const abnbInv = data?.inventory?.['ABNB'];
        console.log(`\n[Current Snapshot State]:`);
        if (abnbInv) {
            console.log("❌ ABNB Inventory STILL EXISTS:", JSON.stringify(abnbInv));
        } else {
            console.log("✅ ABNB Inventory completely REMOVED.");
        }
    } else {
        console.log("❌ Snapshot Document 2025-08-31 NOT FOUND.");
    }
}

verifyFixAndGetBackup().catch(console.error);
