
import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '@/lib/firebase-admin';

// Initialize Firebase Admin (Server-side)
initializeFirebaseAdmin();
const db = getFirestore();

const BIAODI_DIR = path.join(process.cwd(), 'biaodi');

async function processFile(filePath: string) {
    const fileName = path.basename(filePath);
    console.log(`[API] Processing file: ${fileName}`);

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
        }

        const parts = line.split(',');
        if (parts.length < 8) continue;

        const rawTicker = parts[0].trim();
        const rawDate = parts[2].trim();
        const rawClose = parts[7].trim();

        if (!rawTicker || !rawDate || !rawClose) continue;

        const symbol = rawTicker.replace(/\.US$/i, '').toUpperCase();

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
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    return count;
}

export async function POST() {
    try {
        if (!fs.existsSync(BIAODI_DIR)) {
            return NextResponse.json({ message: 'Directory not found', count: 0 }, { status: 404 });
        }

        const files = fs.readdirSync(BIAODI_DIR);
        let totalImported = 0;
        const results = [];

        for (const file of files) {
            const filePath = path.join(BIAODI_DIR, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
                const count = await processFile(filePath);
                totalImported += count;
                results.push({ file, count });
            }
        }

        return NextResponse.json({
            message: 'Import completed',
            totalImported,
            details: results
        });

    } catch (error: any) {
        console.error('[API] Import failed:', error);
        return NextResponse.json({ message: 'Import failed', error: error.message }, { status: 500 });
    }
}
