
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function analyzeProviders() {
    console.log('📡 正在分析数据库中的 EOD Provider 类型...');
    console.log('----------------------------------------');

    const snapshot = await db.collection('officialCloses').get();
    const counters: Record<string, number> = {};

    snapshot.forEach(doc => {
        const data = doc.data();
        const provider = data.provider || '(No Provider)';

        // 简单归类
        const key = provider.toLowerCase().trim();
        counters[key] = (counters[key] || 0) + 1;
    });

    console.log('\n📊 统计结果 (Provider Distribution):');

    // 按数量排序
    const sorted = Object.entries(counters).sort((a, b) => b[1] - a[1]);

    sorted.forEach(([key, count]) => {
        let label = '未知';
        if (key.includes('yahoo')) label = '✅ 雅虎API (EOD)';
        else if (key.includes('polygon')) label = '✅ Polygon (Master Backfill)';
        else if (key.includes('realtime') || key.includes('close')) label = '⚠️ 实时价格填充 (RT)';
        else if (key.includes('tx') || key.includes('transaction')) label = '❌ 交易价格填充 (Dirty)';
        else if (key === '(no provider)') label = '❌ 无来源标记 (Null)';

        console.log(`${key.padEnd(30)}: ${count.toString().padEnd(6)} [${label}]`);
    });

    console.log(`\n总记录数: ${snapshot.size}`);
}

analyzeProviders().catch(console.error);
