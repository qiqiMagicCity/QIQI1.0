
import * as admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

// Explicitly defining the data to ensure 1:1 match with source code
const STOCK_SPLITS_TO_MIGRATE = [
    { symbol: 'NFLX', effectiveDate: '2025-11-17', splitRatio: 10 },
    { symbol: 'NVDA', effectiveDate: '2024-06-07', splitRatio: 10 },
    { symbol: 'TSLA', effectiveDate: '2022-08-25', splitRatio: 3 },
    { symbol: 'NFLX', effectiveDate: '2015-07-15', splitRatio: 7 },
];

async function migrate() {
    // 1. Initialize Firebase Admin
    if (!getApps().length) {
        try {
            // Attempt to use default credentials (GOOGLE_APPLICATION_CREDENTIALS or GCloud CLI)
            admin.initializeApp();
            console.log('✅ Firebase Admin Initialized');
        } catch (e) {
            console.error('❌ Failed to initialize Firebase Admin. Ensure you have credentials set up.');
            console.error(e);
            process.exit(1);
        }
    }

    const db = admin.firestore();
    const batch = db.batch();
    const collectionRef = db.collection('corporate_actions');

    console.log(`📦 Preparing to migrate ${STOCK_SPLITS_TO_MIGRATE.length} split events...`);

    for (const split of STOCK_SPLITS_TO_MIGRATE) {
        // Construct a unique and readable ID
        // Note: Using UPPERCASE symbol to ensure standard IDs
        const symbolUpper = split.symbol.trim().toUpperCase();
        const docId = `SPLIT_${symbolUpper}_${split.effectiveDate}`;
        const docRef = collectionRef.doc(docId);

        const docData = {
            type: 'SPLIT',
            symbol: symbolUpper,
            effectiveDate: split.effectiveDate,
            ratio: split.splitRatio,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            // Metadata to track origin
            source: 'migration_script_v1',
        };

        // Use set({merge: true}) to avoid overwriting existing manually edited fields if any found
        batch.set(docRef, docData, { merge: true });
        console.log(`   + Staged: ${docId}`);
    }

    try {
        await batch.commit();
        console.log('🚀 Migration committed successfully!');
    } catch (e) {
        console.error('❌ Migration failed during commit:', e);
        process.exit(1);
    }
}

migrate();
