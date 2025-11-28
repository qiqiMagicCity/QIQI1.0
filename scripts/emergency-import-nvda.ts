
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) {
    // Attempt to find service account or use default credentials
    try {
        const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
        if (fs.existsSync(serviceAccountPath)) {
            admin.initializeApp({
                credential: admin.credential.cert(require(serviceAccountPath))
            });
        } else {
            admin.initializeApp();
        }
    } catch (e) {
        console.error("Init failed", e);
        process.exit(1);
    }
}

const db = getFirestore();

async function run() {
    const filePath = path.join(process.cwd(), 'biaodi', 'NVDA');
    console.log(`Reading file: ${filePath}`);

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        console.log(`Last line: ${lastLine}`);

        // Format: NVDA.US,D,20251124,000000,179.49,183.5,176.48,182.55,256618335,0
        const parts = lastLine.split(',');
        if (parts.length < 9) {
            console.error("Invalid format");
            return;
        }

        const dateStr = parts[2]; // 20251124
        const close = parseFloat(parts[7]); // 182.55

        // Format date to YYYY-MM-DD
        const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        const symbol = 'NVDA';
        const docId = `${formattedDate}_${symbol}`;

        console.log(`Writing to Firestore: ID=${docId}, Close=${close}`);

        await db.collection('officialCloses').doc(docId).set({
            symbol: symbol,
            date: formattedDate,
            tradingDate: formattedDate,
            close: close,
            status: 'ok',
            provider: 'manual_import_local',
            updatedAt: new Date()
        }, { merge: true });

        console.log("Successfully saved NVDA data.");

    } catch (error) {
        console.error("Error:", error);
    }
}

run();
