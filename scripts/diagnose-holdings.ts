
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { format, subDays, isWeekend } from 'date-fns';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

function getLastTradingDay(): string {
    let date = new Date();
    // 如果今天是周末，往前推
    while (isWeekend(date)) {
        date = subDays(date, 1);
    }
    // 如果还没收盘（比如早上），取前一天？
    // 假设取昨天作为最新的完整EOD日
    date = subDays(date, 1);
    while (isWeekend(date)) {
        date = subDays(date, 1);
    }
    return format(date, 'yyyy-MM-dd');
}

async function checkHoldingsEOD() {
    console.log('🔍 正在检查当前持仓的 EOD 覆盖情况...');
    const targetDate = getLastTradingDay();
    console.log(`📅 目标日期 (最近交易日): ${targetDate}`);

    // 1. 获取所有交易以计算当前持仓
    const txSnapshot = await db.collectionGroup('transactions').get();
    const holdings: Record<string, number> = {};
    const assetTypes: Record<string, string> = {};

    txSnapshot.forEach(doc => {
        const tx = doc.data();
        const symbol = tx.symbol;
        if (!symbol) return;

        const qty = Number(tx.quantity || 0);
        holdings[symbol] = (holdings[symbol] || 0) + qty;
        assetTypes[symbol] = tx.assetType || 'stock';
    });

    // 过滤出持仓不为0的资产
    const activeSymbols = Object.keys(holdings).filter(s => Math.abs(holdings[s]) > 0.0001);
    console.log(`📦 当前活跃持仓: ${activeSymbols.length} 个`);

    let missingCount = 0;
    let foundCount = 0;

    console.log('\n--- 缺失 EOD 的资产详情 ---');

    for (const symbol of activeSymbols) {
        const type = assetTypes[symbol];
        if (type !== 'option') continue; // 用户特别关心期权，先只看期权？或者都看

        // 检查 officialCloses
        const docId = `${symbol}_${targetDate}`;
        const docRef = db.collection('officialCloses').doc(docId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            foundCount++;
        } else {
            console.log(`❌ [MISSING] ${symbol} (${type}) - 暂无 ${targetDate} 数据`);
            missingCount++;

            // 尝试读取该资产最近的一条数据
            const recentSnap = await db.collection('officialCloses')
                .where('symbol', '==', symbol)
                .limit(500) // 获取最近的几百条
                .get();

            if (!recentSnap.empty) {
                const docs = recentSnap.docs.map(d => d.data());
                docs.sort((a, b) => b.date.localeCompare(a.date)); // 内存排序
                const latest = docs[0];
                console.log(`    ↳ 最新可用: ${latest.date} (Provider: ${latest.provider})`);
            } else {
                console.log(`    ↳ ⚠️ 数据库里一条数据都没有!`);
            }
        }
    }

    console.log('\n----------------------------------------');
    console.log(`📊 统计 (仅期权 Option):`);
    console.log(`✅ 已覆盖: ${foundCount}`);
    console.log(`❌ 缺失: ${missingCount}`);
}

checkHoldingsEOD().catch(console.error);
