
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Fix TS Environment
const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Setup Emulator
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'firebase-studio-1761782845873';

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Target User
const USER_ID = 'fqbkSoyuAKQ4JDG13KaMKMHK9Ep2';

async function inspect() {
    console.log(`\n🔍 正在精准审计用户 [${USER_ID}] 的 NFLX 记录...`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`| ID (前6位) | 日期字符串 (DateNy) | 原始时间戳 (ms) | 系统反推美东时间 (Check) | 偏差分析 |`);
    console.log(`--------------------------------------------------------------------------------`);

    const snapshot = await db.collection('users').doc(USER_ID).collection('transactions')
        .where('symbol', '==', 'NFLX')
        .get();

    if (snapshot.empty) {
        console.log("❌ 未找到 NFLX 记录，请确认 Emulator 是否运行中。");
        return;
    }

    snapshot.forEach(doc => {
        const d = doc.data();
        const ts = d.transactionTimestamp;

        // 关键：系统当前认为该时间戳代表的真实时间
        const nyTimeStr = new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' });

        // 检查是否有明显的不一致
        // 比如 DateNy 说它是 10-21，但 Timestamp 转出来却是 10-20 或 10-22
        const datePart = nyTimeStr.split(',')[0]; // "10/21/2025" or "10/20/2025"
        const [mm, dd, yyyy] = datePart.split('/');
        const formattedNyDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

        let status = "✅ 正常";
        if (formattedNyDate !== d.transactionDateNy) {
            status = `❌ 严重偏差! (系统存为 ${formattedNyDate})`;
        }

        console.log(`| ${doc.id.slice(0, 6)}...   | ${d.transactionDateNy.padEnd(10)}      | ${ts}   | ${nyTimeStr.padEnd(22)}   | ${status} |`);
    });
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`\n说明: 如果"系统反推美东时间"与"日期字符串"不符，说明存储时算法有误，导致时间戳被写偏了。`);
}

inspect().catch(console.error);
