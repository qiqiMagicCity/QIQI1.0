
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

// Standard OCC Regex: Root (any length, usually <6) + YYMMDD + C/P + 8 digits
// Note: Strict OCC has spaces padding the root to 6 chars, but simplified OCC often omits spaces.
// Yahoo Finance expects: Root + YYMMDD + C/P + 00000000 (8 digits)
const OCC_REGEX = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;

async function main() {
    console.log("=== AUDIT OPTION SYMBOLS ===");

    // 1. Get all users
    const usersSnap = await db.collection('users').get();
    console.log(`Found ${usersSnap.size} users.`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        console.log(`\nChecking User: ${uid}`);

        // 2. Get Holdings
        const holdingsSnap = await db.collection('users').doc(uid).collection('holdings').get();
        if (holdingsSnap.empty) {
            console.log("  No holdings.");
            continue;
        }

        const options = [];
        const nonCompliant = [];

        for (const doc of holdingsSnap.docs) {
            const data = doc.data();
            const symbol = data.symbol || doc.id;

            // Heuristic for Option: Contains numbers and C/P
            // Or better, just check if it matches the general structure
            // Skip pure stocks (usually just letters)
            if (/^[A-Z]+$/.test(symbol)) continue;

            const isOption = /[0-9]/.test(symbol) && /[CP]/.test(symbol);
            if (!isOption) continue;

            options.push(symbol);

            if (!OCC_REGEX.test(symbol)) {
                nonCompliant.push(symbol);
            }
        }

        console.log(`  Found ${options.length} potential options.`);
        if (nonCompliant.length > 0) {
            console.warn(`  COMBING ALERT: ${nonCompliant.length} symbols do NOT match strict OCC format (missing padding?):`);
            nonCompliant.forEach(s => console.log(`    - ${s}`));
        } else if (options.length > 0) {
            console.log(`  SUCCESS: All ${options.length} options match strict OCC format.`);
        }
    }
}

main().catch(console.error);
