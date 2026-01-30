
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'firebase-studio-1761782845873';

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const USER_ID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function investigateNflx() {
    console.log(`\n🔍 正在深度侦查用户 [${USER_ID}] 的 NFLX 记录...`);
    console.log(`目标日期: 2025-10-21 (前后宽泛搜索)`);

    // Fetch ALL NFLX records to find the duplicates and the ghost
    const snap = await db.collection('users').doc(USER_ID).collection('transactions')
        .where('symbol', '==', 'NFLX')
        .get();

    console.log(`Found ${snap.size} NFLX records total.`);

    const records: any[] = [];
    snap.forEach(doc => records.push({ id: doc.id, ...doc.data() }));

    // Filter for relevant ones (around 10/21)
    const relevant = records.filter(r => {
        const d = r.transactionDateNy || '';
        return d.includes('2025-10-21') || d.includes('2025-10-20') || d.includes('2025-10-22');
    });

    // Sort by Time
    relevant.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    console.log(`\n=== NFLX Records Report (2025-10-21 Context) ===`);
    console.log(`ID (Top 6) | DateNy String       | Time (NY)    | Side | Qty | Price     | Timestamp      | Analysis`);
    console.log(`-----------|---------------------|--------------|------|-----|-----------|----------------|---------`);

    relevant.forEach(r => {
        const tsDate = new Date(r.transactionTimestamp);
        const nyTime = tsDate.toLocaleString('en-US', { timeZone: 'America/New_York' });
        const timePart = nyTime.split(',')[1].trim();

        let note = '';
        if (Math.abs(r.price - 1242.36) < 0.01) note = '🚨 TARGET (15:55)';
        if (Math.abs(r.price - 1242.00) < 0.01 && r.side === 'BUY') note = '⚠️ TARGET (13:52)';

        console.log(`${r.id.slice(0, 6)}... | "${r.transactionDateNy}" | ${timePart.padEnd(12)} | ${r.type || r.side} | ${r.quantity} | ${r.price.toFixed(4)} | ${r.transactionTimestamp} | ${note}`);
    });

    console.log(`\n-----------------------------------------------------`);
    console.log(`Expected: 1x BUY 100 @ 1242.00 (13:52)`);
    console.log(`Actual:   Look above. If 2x BUY exist, we have duplicates.`);
    console.log(`          If SELL @ 1242.36 exists, we have the ghost.`);
}

investigateNflx().catch(console.error);
