
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Helper to remove spaces from options symbol only
function normalizeSymbol(sym: string): string {
    if (!sym) return '';
    // If it looks like NKE 260109 C 65
    // Remove all spaces
    return sym.replace(/\s+/g, '');
}

async function run() {
    console.log("=== Fix Spaced Symbols (NKE 260109 C 65 -> NKE260109C65) ===");

    // Scan all users
    const usersSnap = await db.collection('users').get();
    let count = 0;

    for (const userDoc of usersSnap.docs) {
        console.log(`Scanning user ${userDoc.id}...`);
        const txRef = userDoc.ref.collection('transactions');
        const txSnap = await txRef.get();

        const batch = db.batch();
        let batchCount = 0;

        txSnap.forEach(doc => {
            const data = doc.data();
            const originalSym = data.symbol || '';
            const cleanSym = normalizeSymbol(originalSym);

            if (originalSym !== cleanSym && cleanSym.length > 0) {
                // Check if it's an option (contains digit)
                if (/\d/.test(cleanSym)) {
                    console.log(`Fixing ${doc.id}: '${originalSym}' -> '${cleanSym}'`);
                    batch.update(doc.ref, { symbol: cleanSym });
                    batchCount++;
                    count++;
                }
            }
        });

        if (batchCount > 0) {
            await batch.commit();
            console.log(`Committed ${batchCount} updates for user ${userDoc.id}`);
        }
    }
    console.log(`=== Done. Fixed ${count} transactions. ===`);
}

run();
