/**
 * 🎯 SURGICAL FIX - 精准狙击修复
 * 
 * 目标：只修复 Missing EOD 数据（系统显示 2471 个缺口）
 * 策略：
 *   1. 静默扫描 - 只在成功修复时输出
 *   2. 精准打击 - 只处理 Missing 数据
 *   3. 实时倒计时 - 显示剩余缺口数
 */

import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { format, subDays, eachDayOfInterval, parseISO, isBefore, isWeekend } from 'date-fns';

// ============================================
// 硬编码配置
// ============================================
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';
const RATE_LIMIT_MS = 150;
const OPTIONS_CUTOFF_DATE = '2024-02-01';

// ============================================
// 初始化 Firebase
// ============================================
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// ============================================
// 类型定义
// ============================================

interface Transaction {
    symbol: string;
    assetType?: 'stock' | 'option';
    type: string;
    quantity: number | string;
    timestamp?: any;
    date?: string;
}

interface MissingRecord {
    symbol: string;
    date: string;
    isOption: boolean;
}

// ============================================
// 工具函数
// ============================================

const normalize = (s: string) => s.trim().toUpperCase();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isOption(symbol: string): boolean {
    return /^[A-Z]+\s+\d{6}\s+[CP]\s+[\d\.]+$/.test(symbol.trim());
}

function extractOptionExpiry(symbol: string): string | null {
    const match = symbol.match(/^[A-Z]+\s+(\d{6})\s+[CP]\s+[\d\.]+$/);
    if (!match) return null;

    const yymmdd = match[1];
    const year = parseInt('20' + yymmdd.substring(0, 2));
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);

    return `${year}-${month}-${day}`;
}

function isOptionCompliant(symbol: string): boolean {
    const expiryDate = extractOptionExpiry(symbol);
    if (!expiryDate) return false;

    try {
        const expiry = parseISO(expiryDate);
        const cutoff = parseISO(OPTIONS_CUTOFF_DATE);
        return !isBefore(expiry, cutoff);
    } catch {
        return false;
    }
}

function toPolygonOptionTicker(symbol: string): string | null {
    const s = symbol.trim().toUpperCase().replace(/\s+/g, ' ');
    const match = s.match(/^([A-Z]+)\s(\d{6})\s([CP])\s([\d\.]+)$/);

    if (!match) return null;

    const [_, root, date, type, strikeStr] = match;
    const strike = parseFloat(strikeStr);
    const strikeInt = Math.round(strike * 1000);
    const strikePart = strikeInt.toString().padStart(8, '0');

    return `O:${root}${date}${type}${strikePart}`;
}

async function fetchStockEOD(symbol: string, date: string): Promise<number | null> {
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&sort=asc&limit=1&apiKey=${POLYGON_KEY}`;

    try {
        const res = await fetch(url);
        const data: any = await res.json();

        if (res.ok && data.results && data.results.length > 0) {
            return data.results[0].c;
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchOptionEOD(symbol: string, date: string): Promise<number | null> {
    const polygonTicker = toPolygonOptionTicker(symbol);
    if (!polygonTicker) return null;

    const url = `https://api.polygon.io/v2/aggs/ticker/${polygonTicker}/range/1/day/${date}/${date}?adjusted=true&sort=asc&limit=1&apiKey=${POLYGON_KEY}`;

    try {
        const res = await fetch(url);
        const data: any = await res.json();

        if (res.ok && data.results && data.results.length > 0) {
            return data.results[0].c;
        }
        return null;
    } catch {
        return null;
    }
}

async function writeEOD(symbol: string, date: string, close: number, provider: string): Promise<boolean> {
    try {
        const docId = `${date}_${symbol}`;
        await db.collection('officialCloses').doc(docId).set({
            symbol: symbol,
            tradingDate: date,
            close: close,
            provider: provider,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch {
        return false;
    }
}

function getStockFirstTradeDate(transactions: Transaction[], symbol: string): string {
    const symbolTxs = transactions.filter(tx => normalize(tx.symbol) === symbol);

    if (symbolTxs.length === 0) {
        return format(subDays(new Date(), 365 * 10), 'yyyy-MM-dd');
    }

    let earliestDate: Date | null = null;

    for (const tx of symbolTxs) {
        let txDate: Date | null = null;

        if (tx.timestamp) {
            txDate = tx.timestamp.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp);
        } else if (tx.date) {
            txDate = parseISO(tx.date);
        }

        if (txDate && (!earliestDate || txDate < earliestDate)) {
            earliestDate = txDate;
        }
    }

    if (earliestDate) {
        return format(subDays(earliestDate, 30), 'yyyy-MM-dd');
    }

    return format(subDays(new Date(), 365 * 10), 'yyyy-MM-dd');
}

function getOptionTradeDateRange(symbol: string): { start: string; end: string } | null {
    const expiryDate = extractOptionExpiry(symbol);
    if (!expiryDate) return null;

    const expiry = parseISO(expiryDate);
    const cutoff = parseISO(OPTIONS_CUTOFF_DATE);

    const ninetyDaysBeforeExpiry = subDays(expiry, 90);
    const startDate = isBefore(cutoff, ninetyDaysBeforeExpiry) ? ninetyDaysBeforeExpiry : cutoff;

    const today = new Date();
    const endDate = isBefore(expiry, today) ? expiry : today;

    return {
        start: format(startDate, 'yyyy-MM-dd'),
        end: format(endDate, 'yyyy-MM-dd')
    };
}

// ============================================
// 主逻辑 - 精准狙击
// ============================================

async function main() {
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║  🎯 SURGICAL FIX - 精准狙击修复 Missing EOD       ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    let totalFixed = 0;
    let totalFailed = 0;

    // ==========================================
    // 步骤 1: 静默扫描，收集所有 Missing 数据
    // ==========================================
    console.log('🔍 扫描所有活跃资产的 Missing EOD...');

    const userRefs = await db.collection('users').listDocuments();
    const allTransactions: Transaction[] = [];
    const holdings = new Map<string, number>();

    for (const userRef of userRefs) {
        const snap = await userRef.collection('transactions').get();
        snap.forEach(doc => {
            const tx = doc.data() as Transaction;
            allTransactions.push(tx);

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

    // 收集所有 Missing 记录
    const missingRecords: MissingRecord[] = [];

    for (const symbol of activeSymbols) {
        const isOpt = isOption(symbol);

        // 获取日期范围
        let startDate: string;
        let endDate: string;

        if (isOpt) {
            // 期权：检查是否合规
            if (!isOptionCompliant(symbol)) {
                continue; // 跳过过期期权
            }

            const range = getOptionTradeDateRange(symbol);
            if (!range) continue;

            startDate = range.start;
            endDate = range.end;
        } else {
            // 股票：从第一次交易到今天
            startDate = getStockFirstTradeDate(allTransactions, symbol);
            endDate = format(new Date(), 'yyyy-MM-dd');
        }

        // 生成所有应该有数据的日期
        const tradingDays = eachDayOfInterval({
            start: parseISO(startDate),
            end: parseISO(endDate)
        }).filter(d => !isWeekend(d)).map(d => format(d, 'yyyy-MM-dd'));

        // 静默检查每一天
        for (const date of tradingDays) {
            const docId = `${date}_${symbol}`;
            const docRef = db.collection('officialCloses').doc(docId);
            const doc = await docRef.get();

            if (!doc.exists) {
                // Missing!
                missingRecords.push({ symbol, date, isOption: isOpt });
            }
        }
    }

    console.log(`\n✅ 扫描完成！发现 ${missingRecords.length} 条 Missing EOD 数据\n`);

    if (missingRecords.length === 0) {
        console.log('🎉 没有缺失数据，任务完成！');
        return;
    }

    // ==========================================
    // 步骤 2: 精准狙击 - 只修复 Missing
    // ==========================================
    console.log('🎯 开始精准修复...\n');
    console.log('─────────────────────────────────────────────────────');

    let remaining = missingRecords.length;

    for (const record of missingRecords) {
        const { symbol, date, isOption: isOpt } = record;

        // 调用 Polygon API
        const close = isOpt
            ? await fetchOptionEOD(symbol, date)
            : await fetchStockEOD(symbol, date);

        if (close !== null) {
            // 写入成功
            const success = await writeEOD(symbol, date, close, 'polygon-surgical-fix');
            if (success) {
                totalFixed++;
                remaining--;
                console.log(`[FIXED] ${symbol} ${date}: Recovered from Polygon ($${close.toFixed(2)}) [剩余: ${remaining}]`);
            } else {
                totalFailed++;
            }
        } else {
            totalFailed++;
            // 静默失败（不打印，可能是节假日或无数据）
        }

        // 速率限制
        await sleep(RATE_LIMIT_MS);
    }

    // ==========================================
    // 步骤 3: 汇报结果
    // ==========================================
    console.log('\n─────────────────────────────────────────────────────');
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║           ✨ 精准修复完成                          ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log(`总缺口数: ${missingRecords.length}`);
    console.log(`✅ 成功修复: ${totalFixed}`);
    console.log(`❌ 无法修复: ${totalFailed} (可能是节假日/无交易数据)\n`);

    if (totalFixed > 0) {
        console.log('🎉 数据已写入 Firebase！刷新网页查看缺口倒计时。');
    }
}

// ============================================
// 启动
// ============================================

main()
    .then(() => {
        console.log('\n✅ 脚本执行完毕');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 脚本执行失败:', err);
        process.exit(1);
    });
