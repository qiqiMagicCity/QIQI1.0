import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
// Assuming GOOGLE_APPLICATION_CREDENTIALS is set or we can use default creds in this environment
// If not, we might need to use a service account key, but let's try default first as user is in dev env.
if (!admin.apps.length) {
    try {
        admin.initializeApp();
        console.log('Firebase Admin initialized.');
    } catch (e) {
        console.error('Failed to initialize Firebase Admin:', e);
        process.exit(1);
    }
}

const db = getFirestore();
const BIAODI_DIR = path.join(process.cwd(), 'biaodi');

async function processFile(filePath: string) {
    const fileName = path.basename(filePath);
    console.log(`Processing file: ${fileName}`);

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let isHeader = true;
    let count = 0;
    const batchSize = 400;
    let batch = db.batch();
    let batchCount = 0;

    for await (const line of rl) {
        if (isHeader) {
            if (line.startsWith('<TICKER>')) {
                isHeader = false;
                continue;
            }
            // If no header line found yet, check if this line looks like data
            // But the example has header.
        }

        const parts = line.split(',');
        if (parts.length < 8) continue;

        // Format: <TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>
        // Example: OKLO.US,D,20210708,000000,10,10.04,9.97,9.98,15054506,0

        const rawTicker = parts[0].trim(); // OKLO.US
        const rawDate = parts[2].trim();   // 20210708
        const rawClose = parts[7].trim();  // 9.98

        if (!rawTicker || !rawDate || !rawClose) continue;

        // Normalize Ticker: Remove .US if present
        const symbol = rawTicker.replace(/\.US$/i, '').toUpperCase();

        // Format Date: YYYYMMDD -> YYYY-MM-DD
        if (rawDate.length !== 8) continue;
        const dateStr = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;

        const closePrice = parseFloat(rawClose);
        if (isNaN(closePrice)) continue;

        const docId = `${dateStr}_${symbol}`;
        const docRef = db.collection('officialCloses').doc(docId);

        batch.set(docRef, {
            symbol,
            date: dateStr,
            tradingDate: dateStr,
            close: closePrice,
            status: 'ok',
            provider: 'local_import',
            updatedAt: new Date()
        }, { merge: true });

        batchCount++;
        count++;

        if (batchCount >= batchSize) {
            await batch.commit();
            console.log(`  Committed batch of ${batchCount} records...`);
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
        console.log(`  Committed final batch of ${batchCount} records.`);
    }

    console.log(`Finished processing ${fileName}: ${count} records imported.`);
}

async function main() {
    if (!fs.existsSync(BIAODI_DIR)) {
        console.error(`Directory not found: ${BIAODI_DIR}`);
        return;
    }

    const files = fs.readdirSync(BIAODI_DIR);
    console.log(`Found ${files.length} files in ${BIAODI_DIR}`);

    for (const file of files) {
        const filePath = path.join(BIAODI_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
            await processFile(filePath);
        }
    }
    console.log('All files processed.');
}

main().catch(console.error);
