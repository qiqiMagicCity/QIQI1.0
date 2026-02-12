
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { format, subDays, eachDayOfInterval, parseISO, isBefore, isWeekend } from 'date-fns';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

// List of options to check
const targets = [
    { symbol: 'AAPL 260206 C 270', desc: 'Apple Call Options' },
    { symbol: 'GOOGL 260918 C 150', desc: 'Google Call Options' },
    { symbol: 'NIO 260618 P 3.5', desc: 'NIO Put Options' }
];

async function checkStatus() {
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║  ✅ 修复结果验证 (Verification Report)            ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    for (const target of targets) {
        console.log(`🔍 检查目标: ${target.desc} (${target.symbol})`);

        // Check recent 3 trading days
        const today = new Date();
        const days = eachDayOfInterval({
            start: subDays(today, 5),
            end: today
        }).filter(d => !isWeekend(d)).map(d => format(d, 'yyyy-MM-dd'));

        let found = 0;
        let missing = 0;

        for (const date of days) {
            const docId = `${date}_${target.symbol}`;
            const doc = await db.collection('officialCloses').doc(docId).get();

            if (doc.exists) {
                const data = doc.data() as any;
                console.log(`   ✅ ${date}: $${data.close?.toFixed(2)} (Provider: ${data.provider})`);
                found++;
            } else {
                console.log(`   ❌ ${date}: 缺失 (Missing)`);
                missing++;
            }
        }

        if (found > 0) {
            console.log(`   🎉 结论: 数据已成功写入！\n`);
        } else {
            console.log(`   ⚠️ 结论: 仍未找到数据。\n`);
        }
    }
}

checkStatus();
