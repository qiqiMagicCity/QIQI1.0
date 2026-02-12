
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// 待排查的目标 (前端符号)
const targets = [
    { symbol: 'GOOGL260918C150', date: '2026-02-06', polygon: 'O:GOOGL260918C00150000' },
    { symbol: 'NVO261218C50', date: '2026-02-06', polygon: 'O:NVO261218C00050000' },
    { symbol: 'NIO260618P3.5', date: '2026-02-06', polygon: 'O:NIO260618P00003500' },
    { symbol: 'AAPL260206C270', date: '2026-02-06', polygon: 'O:AAPL260206C00270000' }
];

async function diagnose() {
    console.log('=== 全链路数据排查报告 ===\n');

    for (const item of targets) {
        console.log(`🔎 标的: ${item.symbol} (${item.date})`);

        // 1. 检查数据库
        const docId = `${item.date}_${item.symbol}`;
        const docRef = db.collection('officialCloses').doc(docId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            console.log(`   [DB] 存在文档! 状态: ${docSnap.data()?.status}, 提供商: ${docSnap.data()?.provider}, 收盘价: ${docSnap.data()?.close}`);
        } else {
            console.log(`   [DB] ❌ 文档不存在 (Expected ID: ${docId})`);
        }

        // 2. 检查 Polygon API (针对该标的)
        const url = `https://api.polygon.io/v2/aggs/ticker/${item.polygon}/range/1/day/${item.date}/${item.date}?adjusted=true&apiKey=${POLYGON_KEY}`;
        try {
            const res = await fetch(url);
            const data: any = await res.json();
            if (res.ok && data.results && data.results.length > 0) {
                console.log(`   [API] ✅ Polygon 有数据! 价格: ${data.results[0].c}`);
            } else {
                console.log(`   [API] ❌ Polygon 无数据. 错误信息: ${JSON.stringify(data)}`);
            }
        } catch (e: any) {
            console.log(`   [API] 💥 请求异常: ${e.message}`);
        }
        console.log('');
    }
}

diagnose().then(() => process.exit(0));
