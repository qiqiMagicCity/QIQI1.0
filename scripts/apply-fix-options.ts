
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// 待修复的目标
const targets = [
    { symbol: 'GOOGL260918C150', date: '2026-02-06', polygon: 'O:GOOGL260918C00150000' },
    { symbol: 'NVO261218C50', date: '2026-02-06', polygon: 'O:NVO261218C00050000' },
    { symbol: 'NIO260618P3.5', date: '2026-02-06', polygon: 'O:NIO260618P00003500' },
    { symbol: 'AAPL260206C270', date: '2026-02-06', polygon: 'O:AAPL260206C00270000' }
];

async function fix() {
    console.log('=== 🛠️ 开始执行数据格式统一修复 ===\n');

    for (const item of targets) {
        console.log(`Processing ${item.symbol}...`);

        // 1. 获取 API 数据
        const url = `https://api.polygon.io/v2/aggs/ticker/${item.polygon}/range/1/day/${item.date}/${item.date}?adjusted=true&apiKey=${POLYGON_KEY}`;
        try {
            const res = await fetch(url);
            const data: any = await res.json();

            if (res.ok && data.results && data.results.length > 0) {
                const close = data.results[0].c;
                const correctDocId = `${item.date}_${item.symbol}`;

                // 2. 写入正确格式
                await db.collection('officialCloses').doc(correctDocId).set({
                    symbol: item.symbol,
                    tradingDate: item.date,
                    close: close,
                    provider: 'polygon-repair-script',
                    status: 'ok',
                    updatedAt: new Date().toISOString()
                });
                console.log(`   ✅ 已写入正确 ID: ${correctDocId} ($${close})`);

                // 3. 检查并清理可能的错误 ID (长格式)
                const wrongDocId = `${item.date}_${item.polygon.replace('O:', '')}`;
                if (wrongDocId !== correctDocId) {
                    await db.collection('officialCloses').doc(wrongDocId).delete();
                    console.log(`   🧹 已清理错误 ID: ${wrongDocId}`);
                }
            } else {
                console.log(`   ❌ 抓取失败: ${item.symbol}`);
            }
        } catch (e: any) {
            console.log(`   💥 异常: ${e.message}`);
        }
    }

    // 额外清理 2月3日和4日的 NVO 错误 ID
    const extraLongIds = [
        '2026-02-03_NVO261218C00050000',
        '2026-02-04_NVO261218C00050000'
    ];
    for (const id of extraLongIds) {
        await db.collection('officialCloses').doc(id).delete();
        console.log(`   🧹 已清理额外长 ID: ${id}`);
    }

    console.log('\n✨ 修复任务完成！');
}

fix().then(() => process.exit(0));
