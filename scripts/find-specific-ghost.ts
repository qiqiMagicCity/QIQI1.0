
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

async function locateGhost() {
    console.log(`\n🕵️ 正在精准搜捕目标记录: NFLX 52股 @ $1242.36 ...`);

    // Strategy: Search by Symbol + Price to find the unique ghost
    // We ignore Time/Date completely to find it wherever it hides.

    const snap = await db.collection('users').doc(USER_ID).collection('transactions')
        .where('symbol', '==', 'NFLX')
        .where('price', '==', 1242.36)
        .get();

    console.log(`\n🔎 搜索结果: 找到 ${snap.size} 条匹配记录`);

    if (snap.empty) {
        console.log("❌ 未在 transactions 集合中找到该价格的记录。尝试 trades 集合...");
        const snap2 = await db.collection('users').doc(USER_ID).collection('trades')
            .where('symbol', '==', 'NFLX')
            .where('price', '==', 1242.36)
            .get();

        if (snap2.empty) {
            console.log("❌ trades 集合也未找到。请确认价格是否完全精确 (1242.36)。");
            return;
        }
        snap2.forEach(printDoc);
        return;
    }

    snap.forEach(printDoc);
}

function printDoc(doc: any) {
    const d = doc.data();
    const ts = d.transactionTimestamp;
    const dateObj = new Date(ts);
    const nyTime = dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' });

    console.log(`\n✅ 锁定目标 [ID: ${doc.id}]`);
    console.log(`   - 标的: ${d.symbol}`);
    console.log(`   - 数量: ${d.quantity}`);
    console.log(`   - 价格: ${d.price}`);
    console.log(`   - DateNy (字符串): "${d.transactionDateNy}"`);
    console.log(`   - Timestamp (毫秒): ${ts}`);
    console.log(`   - 真实时间 (UTC):   ${dateObj.toISOString()}`);
    console.log(`   - 真实时间 (NY):    ${nyTime}`);

    // Check Date Mismatch
    const dateNyPart = nyTime.split(',')[0]; // M/D/YYYY
    console.log(`   👉 分析: UI显示日期为 ${d.transactionDateNy}, 但实际时间戳指向 ${dateNyPart} (NY)`);
}

locateGhost().catch(console.error);
