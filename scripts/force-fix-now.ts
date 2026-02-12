/**
 * 🚀 FORCE FIX NOW - 极简修复脚本
 * 
 * 不依赖任何复杂架构，直接：
 * 1. 读取数据库中 Missing EOD 的记录
 * 2. 直连 Polygon API 获取数据
 * 3. 直写 Firebase
 * 
 * 硬编码 API Key，单线程，200ms 速率限制
 */

import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { format, subDays } from 'date-fns';

// ============================================
// 硬编码配置 (避免环境变量问题)
// ============================================
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';
const RATE_LIMIT_MS = 200; // 每次请求间隔 200ms

// ============================================
// 初始化 Firebase
// ============================================
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// ============================================
// 工具函数
// ============================================

/** 规范化股票代码 */
const normalize = (s: string) => s.trim().toUpperCase();

/** 等待指定时间 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 从 Polygon 获取 EOD 数据 */
async function fetchFromPolygon(symbol: string, date: string): Promise<number | null> {
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&sort=asc&limit=120&apiKey=${POLYGON_KEY}`;

    try {
        const res = await fetch(url);
        const data: any = await res.json();

        if (res.ok && data.results && data.results.length > 0) {
            return data.results[0].c; // 返回收盘价
        }

        console.log(`   ⚠️  Polygon 返回空数据: ${data.status || 'No status'}`);
        return null;
    } catch (e: any) {
        console.log(`   ❌ 请求异常: ${e.message}`);
        return null;
    }
}

/** 写入 Firebase */
async function writeToFirebase(symbol: string, date: string, close: number): Promise<boolean> {
    try {
        const docId = `${date}_${symbol}`;
        await db.collection('officialCloses').doc(docId).set({
            symbol: symbol,
            tradingDate: date,
            close: close,
            provider: 'polygon-force-fix',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch (e: any) {
        console.log(`   ❌ 写入失败: ${e.message}`);
        return false;
    }
}

// ============================================
// 主逻辑
// ============================================

async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  🚀 FORCE FIX NOW - 开始强制修复        ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // 1️⃣ 获取所有活跃持仓的股票代码
    console.log('📊 步骤 1: 扫描所有用户交易，获取活跃持仓...');

    const userRefs = await db.collection('users').listDocuments();
    const holdings = new Map<string, number>();

    for (const userRef of userRefs) {
        const snap = await userRef.collection('transactions').get();
        snap.forEach(doc => {
            const tx = doc.data();
            const sym = normalize(tx.symbol);

            let qty = 0;
            if (typeof tx.quantity === 'string') qty = parseFloat(tx.quantity);
            else if (typeof tx.quantity === 'number') qty = tx.quantity;

            if (tx.type === 'SELL' || tx.type === 'SHORT') qty = -Math.abs(qty);
            else qty = Math.abs(qty);

            const curr = holdings.get(sym) || 0;
            holdings.set(sym, curr + qty);
        });
    }

    const activeSymbols = Array.from(holdings.entries())
        .filter(([_, qty]) => Math.abs(qty) > 0.0001)
        .map(([s]) => s)
        .sort();

    console.log(`   ✅ 发现 ${activeSymbols.length} 个活跃股票代码\n`);

    // 2️⃣ 检查最近 10 天的 EOD 数据
    console.log('🔍 步骤 2: 检查 Missing EOD 数据...');

    const today = new Date();
    const checkDates: string[] = [];
    // 从昨天开始（今天的数据可能还未发布 DELAYED）
    for (let i = 1; i <= 10; i++) {
        checkDates.push(format(subDays(today, i), 'yyyy-MM-dd'));
    }
    console.log(`   检查日期范围: ${checkDates[0]} 到 ${checkDates[checkDates.length - 1]}`);

    const missingList: Array<{ symbol: string; date: string }> = [];

    for (const sym of activeSymbols) {
        let found = false;

        // 检查最近是否有数据
        for (const d of checkDates) {
            const docRef = db.collection('officialCloses').doc(`${d}_${sym}`);
            const doc = await docRef.get();
            if (doc.exists && doc.data()?.close > 0) {
                found = true;
                break;
            }
        }

        if (!found) {
            // 尝试修复最近的工作日
            const targetDate = checkDates.find(d => {
                const day = new Date(d).getDay();
                return day !== 0 && day !== 6; // 排除周末
            }) || checkDates[0];

            missingList.push({ symbol: sym, date: targetDate });
        }
    }

    console.log(`   ⚠️  发现 ${missingList.length} 个股票缺少近期数据\n`);

    if (missingList.length === 0) {
        console.log('🎉 所有股票都有最新数据，无需修复！');
        return;
    }

    // 3️⃣ 开始修复
    console.log('🔧 步骤 3: 开始逐个修复 (单线程，200ms 间隔)...\n');
    console.log('───────────────────────────────────────────');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < missingList.length; i++) {
        const { symbol, date } = missingList[i];
        const progress = `[${i + 1}/${missingList.length}]`;

        console.log(`${progress} 正在修复: ${symbol} @ ${date}`);

        // 从 Polygon 获取数据
        const close = await fetchFromPolygon(symbol, date);

        if (close !== null) {
            // 写入 Firebase
            const success = await writeToFirebase(symbol, date, close);
            if (success) {
                console.log(`   ✅ [Success] ${symbol} = $${close.toFixed(2)}\n`);
                successCount++;
            } else {
                console.log(`   ❌ [Failed] 写入失败\n`);
                failCount++;
            }
        } else {
            console.log(`   ❌ [Failed] Polygon 无数据\n`);
            failCount++;
        }

        // 速率限制
        if (i < missingList.length - 1) {
            await sleep(RATE_LIMIT_MS);
        }
    }

    // 4️⃣ 报告结果
    console.log('───────────────────────────────────────────');
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║           📊 修复完成 - 统计结果         ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`\n总计处理: ${missingList.length}`);
    console.log(`✅ 成功修复: ${successCount}`);
    console.log(`❌ 失败数量: ${failCount}`);

    if (successCount > 0) {
        console.log('\n🎉 数据已写入 Firebase！刷新网页即可看到绿色数据。');
    }

    if (failCount > 0) {
        console.log('\n⚠️  部分数据修复失败，可能原因：');
        console.log('   - Polygon API 对该日期/股票无数据');
        console.log('   - 周末或节假日无交易数据');
        console.log('   - 网络连接问题');
    }
}

// ============================================
// 启动
// ============================================

main()
    .then(() => {
        console.log('\n✨ 脚本执行完毕');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 脚本执行失败:', err);
        process.exit(1);
    });
