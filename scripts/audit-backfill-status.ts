
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function main() {
    console.log("=== Audit Backfill Status for 2025-12-31 ===");
    const targetDate = '2025-12-31';

    // 1. Get all user holdings to know what we EXPECT
    const usersSnap = await db.collection('users').get();
    console.log(`Fetched Users Snapshot. Size: ${usersSnap.size}, Empty: ${usersSnap.empty}`);

    const uniqueSymbols = new Set<string>();

    for (const userDoc of usersSnap.docs) {
        console.log(`Checking User: ${userDoc.id}...`);
        const holdingsSnap = await userDoc.ref.collection('holdings').get();
        console.log(`   Found ${holdingsSnap.size} holding docs.`);

        holdingsSnap.forEach(doc => {
            const data = doc.data();
            const sym = data.symbol || doc.id; // Fallback to ID
            if (sym) {
                // Remove option suffixes if needed or just take raw? 
                // EOD map uses "normalized" symbols.
                uniqueSymbols.add(sym);
            }
        });
    }

    // Fallback if users empty (debugging env issue)
    if (uniqueSymbols.size === 0) {
        console.log("⚠️ No users found? Using manual fallback list from screenshot.");
        ['GOOGL', 'NVO', 'NIO', 'AAPL'].forEach(s => uniqueSymbols.add(s));
    }

    const expectedSymbols = Array.from(uniqueSymbols);
    console.log(`User Holdings Count: ${expectedSymbols.length}`);
    // console.log(`Symbols: ${expectedSymbols.join(', ')}`);

    // 2. Check Official Closes for this date
    let foundCount = 0;
    let missingCount = 0;
    const missingSymbols = [];
    const providers = new Set<string>();

    for (const sym of expectedSymbols) {
        // We need to normalize or handle how officialCloses indexes them. 
        // Typically it's `${date}_${nomalizedSymbol}`
        // Let's try raw symbol matches first.

        // Note: Logic in codebase usually uppercases and trims.
        const normalized = sym.trim().toUpperCase();
        const docId = `${targetDate}_${normalized}`;

        const doc = await db.collection('officialCloses').doc(docId).get();
        if (doc.exists) {
            foundCount++;
            const data = doc.data();
            if (data && data.provider) providers.add(data.provider);
        } else {
            missingCount++;
            missingSymbols.push(sym);
        }
    }

    console.log(`\nStatus for ${targetDate}:`);
    console.log(`✅ Success: ${foundCount}`);
    console.log(`❌ Missing: ${missingCount}`);
    console.log(`used Providers: ${Array.from(providers).join(', ')}`);

    if (missingCount > 0) {
        console.log(`\nMissing Symbols (Sample 10):`);
        console.log(missingSymbols.slice(0, 10).join(', '));
    }

    console.log("\n=== Done ===");
}

main();
