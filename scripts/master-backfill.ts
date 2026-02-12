/**
 * 🚀 MASTER BACKFILL PROTOCOL - 全量历史 EOD 修复
 * 
 * 数据治理宪法 (Data Governance Constitution):
 * 
 * 1. 股票 (Stocks): 全历史覆盖（从第一次交易到今天）
 *    - Missing -> 补全
 *    - via_tx (脏数据) -> 强制覆盖
 *    - 正规数据 (yahoo/polygon) -> 跳过
 * 
 * 2. 期权 (Options): 仅 2024-02-01 至今（2年窗口限制）
 *    - 过期日 < 2024-02-01 -> 直接跳过
 *    - 合规合约 -> 补全 Missing 数据
 *    - Polygon 返回空 -> 保持 Missing（不用 via_tx 填充）
 * 
 * 3. 速率控制: 每 150ms 一个请求，单线程稳定写入
 */

import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { format, subDays, eachDayOfInterval, parseISO, isBefore, isWeekend } from 'date-fns';

// ============================================
// 硬编码配置
// ============================================
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';
const RATE_LIMIT_MS = 150; // 每次请求间隔 150ms
const OPTIONS_CUTOFF_DATE = '2024-02-01'; // 期权数据的最早可查询日期

// 🔥 冒烟测试模式 (Smoke Test Mode)
const SMOKE_TEST = process.env.SMOKE_TEST === 'true';
const SMOKE_TEST_LIMIT = 5; // 冒烟测试只处理前 5 个资产

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

interface EODRecord {
    close: number;
    provider: string;
    tradingDate: string;
}

interface BackfillStats {
    totalSymbols: number;
    stockCount: number;
    optionCount: number;
    stockFixed: number;
    stockSkipped: number;
    stockFailed: number;
    optionFixed: number;
    optionSkipped: number;
    optionFailed: number;
    optionTooOld: number;
}

// ============================================
// Helper Functions
// ============================================

// Robust field picker matching frontend logic
function pickFirst(obj: any, keys: string[]) {
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
    }
    return undefined;
}

const normalize = (s: string) => s.trim().replace(/\s+/g, '').toUpperCase();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Judge if it is an option contract (Support Spaces and Compact) */
function isOption(symbol: string): boolean {
    const s = symbol.trim();
    // 1. Spaced format: "AAPL 260206 C 270"
    if (/^[A-Z]+\s+\d{6}\s+[CP]\s+[\d\.]+$/.test(s)) return true;
    // 2. Compact format: "AAPL260206C270" (Letters + 6 Digits + C/P + Digits)
    if (/^[A-Z]+\d{6}[CP]\d+$/.test(s)) return true;
    return false;
}

const parseNumber = (v: any) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v);
    return 0;
};


/** 从期权合约中提取过期日期 */
function extractOptionExpiry(symbol: string): string | null {
    const s = symbol.trim().toUpperCase();

    // Spaced: "AAPL 260206 C 270"
    let match = s.match(/^[A-Z]+\s+(\d{6})\s+[CP]\s+[\d\.]+$/);

    // Compact: "AAPL260206C..."
    if (!match) {
        match = s.match(/^[A-Z]+(\d{6})[CP]\d+$/);
    }

    if (!match) return null;

    const yymmdd = match[1];
    const year = parseInt('20' + yymmdd.substring(0, 2));
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);

    return `${year}-${month}-${day}`;
}

/** 检查期权是否在合规时间窗内 */
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

/** 转换为 Polygon 期权格式 */
function toPolygonOptionTicker(symbol: string): string | null {
    const s = symbol.trim().toUpperCase();

    let root, date, type, strikeStr;

    // 1. Try Compact Format first: AAPL260206C270
    // Note: Use [\d\.]+ to allow decimals in compact too if present (NIO260618P3.5)
    // And handle pure digits correctly.
    const compactMatch = s.match(/^([A-Z]+)(\d{6})([CP])([\d\.]+)$/);
    if (compactMatch) {
        [, root, date, type, strikeStr] = compactMatch;
    } else {
        // 2. Try Spaced Format: AAPL 260206 C 270
        // Clean extra spaces first
        const match = s.replace(/\s+/g, ' ').match(/^([A-Z]+)\s(\d{6})\s([CP])\s([\d\.]+)$/);
        if (match) {
            [, root, date, type, strikeStr] = match;
        }
    }

    if (!root || !date || !type || !strikeStr) return null;

    // Strike Processing:
    // Polygon requires 8-digit integer (milli-dollars).
    // e.g. $270.00 -> 00270000
    // If input is "270" or "3.5", we must scale it.
    // If input is "00270000" (8 digits), we treat it as already scaled.

    let strikeVal = parseFloat(strikeStr);

    // Heuristic: If it contains a dot, OR length < 8, it is Unscaled.
    if (strikeStr.includes('.') || strikeStr.length < 8) {
        strikeVal = strikeVal * 1000;
    }

    const strikePart = Math.round(strikeVal).toString().padStart(8, '0');
    return `O:${root}${date}${type}${strikePart}`;
}

/** 从 Polygon 获取股票 EOD 数据 */
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

/** 从 Polygon 获取期权 EOD 数据 */
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
        // if (process.env.SMOKE_TEST === 'true') console.log(`[POLYGON FAIL] ${date} ${polygonTicker} -> ${JSON.stringify(data)}`);
        return null;
    } catch (e: any) {
        // if (process.env.SMOKE_TEST === 'true') console.log(`[POLYGON ERROR] ${url} -> ${e.message}`);
        return null;
    }
}

/** 检查某日的 EOD 数据状态 */
async function checkEODStatus(symbol: string, date: string): Promise<'missing' | 'dirty' | 'clean'> {
    const docId = `${date}_${symbol}`;
    const docRef = db.collection('officialCloses').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
        return 'missing';
    }

    const data = doc.data() as EODRecord;
    const provider = data.provider || '';

    // 脏数据判断
    if (provider === 'via_tx' || provider === 'manual_dirty' || provider.includes('transaction')) {
        return 'dirty';
    }

    // 正规数据（yahoo, polygon 等）
    return 'clean';
}

/** 写入 EOD 数据到 Firebase */
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
    } catch (e: any) {
        console.log(`      ❌ 写入失败: ${e.message}`);
        return false;
    }
}

/** 获取股票的第一次交易日期 */
const GLOBAL_MIN_DATE = '2024-01-01';

/** 获取股票的第一次交易日期 */
function getStockFirstTradeDate(transactions: Transaction[], symbol: string): string {
    const symbolTxs = transactions.filter(tx => normalize(tx.symbol) === symbol);

    if (symbolTxs.length === 0) {
        // 用户指定交易始于 2024
        return GLOBAL_MIN_DATE;
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
        // 往前推 30 天，确保覆盖第一次交易前的市场价格
        const start = subDays(earliestDate, 30);
        // 但不能早于 2024-01-01
        const minDate = parseISO(GLOBAL_MIN_DATE);

        if (isBefore(start, minDate)) {
            return GLOBAL_MIN_DATE;
        }
        return format(start, 'yyyy-MM-dd');
    }

    // 兜底：2024-01-01
    return GLOBAL_MIN_DATE;
}

// ============================================
// 进度上报
// ============================================

async function updateProgress(
    mode: 'stock' | 'option',
    currentIdx: number,
    total: number,
    symbol: string,
    fixedCount: number,
    lastFixedDisplay: string
) {
    try {
        await db.collection('system').doc('backfill_status').set({
            isActive: true,
            mode: mode,
            current: currentIdx,
            total: total,
            progressPercent: Math.round((currentIdx / total) * 100),
            currentSymbol: symbol,
            totalFixed: fixedCount,
            lastFixed: lastFixedDisplay,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        // 忽略写入错误，不影响主流程
    }
}

/** 获取期权的有效交易日期范围 */
function getOptionTradeDateRange(symbol: string): { start: string; end: string } | null {
    const expiryDate = extractOptionExpiry(symbol);
    if (!expiryDate) return null;

    const expiry = parseISO(expiryDate);
    const cutoff = parseISO(OPTIONS_CUTOFF_DATE);

    // 开始日期：统一从 2024-02-01 开始 (支持长期期权 LEAPS)
    const startDate = cutoff;

    // 结束日期：取过期日和今天中较早的
    const today = new Date();
    const endDate = isBefore(expiry, today) ? expiry : today;

    if (isBefore(endDate, startDate)) {
        return null;
    }

    return {
        start: format(startDate, 'yyyy-MM-dd'),
        end: format(endDate, 'yyyy-MM-dd')
    };
}

// ============================================
// 主逻辑
// ============================================

async function main() {
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║  🚀 MASTER BACKFILL PROTOCOL - 全量历史修复       ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const stats: BackfillStats = {
        totalSymbols: 0,
        stockCount: 0,
        optionCount: 0,
        stockFixed: 0,
        stockSkipped: 0,
        stockFailed: 0,
        optionFixed: 0,
        optionSkipped: 0,
        optionFailed: 0,
        optionTooOld: 0
    };

    // ==========================================
    // 步骤 1: 扫描所有交易，获取活跃资产
    // ==========================================
    console.log('📊 步骤 1: 扫描所有用户交易，提取资产列表...');

    const userRefs = await db.collection('users').listDocuments();
    const allTransactions: Transaction[] = [];
    const holdings = new Map<string, number>();

    for (const userRef of userRefs) {
        const snap = await userRef.collection('transactions').get();
        snap.forEach(doc => {
            const data = doc.data();

            // Robust Symbol Extraction
            const rawSymbol = pickFirst(data, ['symbol', 'ticker', 'underlying', 'symbolRoot', 'optionDetails.symbol']);
            if (!rawSymbol) return;

            // Robust Quantity Extraction
            const qtySrc = pickFirst(data, [
                'qty', 'quantity', 'shares', 'contracts', 'size', 'filledQty', 'filledQuantity', 'orderQty',
                'optionDetails.quantity'
            ]);
            let qty = parseNumber(qtySrc);

            // Robust Type/Side Extraction for Sign
            const typeStr = pickFirst(data, ['type', 'side', 'action', 'operation']) || '';
            const type = String(typeStr).toUpperCase();

            // Logic to determine sign
            if (['SELL', 'SHORT', 'STO', 'STC'].some(k => type.includes(k))) {
                qty = -Math.abs(qty);
            } else {
                qty = Math.abs(qty);
            }

            // Construct normalized transaction for later use
            const tx: Transaction = {
                symbol: String(rawSymbol),
                type: type,
                quantity: qty,
                timestamp: pickFirst(data, ['transactionTimestamp', 'timestamp', 'date', 'tradeDate']),
                assetType: data.assetType
            };

            allTransactions.push(tx);

            const sym = normalize(tx.symbol);
            const curr = holdings.get(sym) || 0;
            holdings.set(sym, curr + qty);
        });
    }

    // 筛选活跃资产
    const activeSymbols = Array.from(holdings.entries())
        .filter(([_, qty]) => Math.abs(qty) > 0.0001)
        .map(([s]) => s)
        .sort();

    console.log(`   ✅ 发现 ${activeSymbols.length} 个活跃资产`);

    // 分类：股票 vs 期权
    const stocks: string[] = [];
    const options: string[] = [];

    for (const sym of activeSymbols) {
        if (isOption(sym)) {
            options.push(sym);
        } else {
            stocks.push(sym);
        }
    }

    stats.totalSymbols = activeSymbols.length;
    stats.stockCount = stocks.length;
    stats.optionCount = options.length;

    console.log(`   📦 股票: ${stocks.length} 个`);
    console.log(`   📊 期权: ${options.length} 个\n`);

    // 🔥 冒烟测试模式限制
    if (SMOKE_TEST) {
        console.log('🔥 冒烟测试模式 (SMOKE TEST MODE)');
        console.log(`   限制处理前 ${SMOKE_TEST_LIMIT} 个资产...\n`);

        // 优先选择：至少1个股票 + 1个期权
        const testStocks = stocks.slice(0, 3);
        const testOptions = options.slice(0, 2);

        stocks.length = 0;
        options.length = 0;
        stocks.push(...testStocks);
        options.push(...testOptions);

        console.log(`   🧪 测试股票: ${stocks.join(', ')}`);
        console.log(`   🧪 测试期权: ${options.join(', ')}\n`);
    }

    // ==========================================
    // 步骤 2: 处理股票 - 全历史覆盖
    // ==========================================
    console.log('🔧 步骤 2: 处理股票 - 全历史覆盖...');
    console.log('─────────────────────────────────────────────────────\n');

    let totalFixedSoFar = 0;

    for (let i = 0; i < stocks.length; i++) {
        const symbol = stocks[i];
        const progressStr = `[Stock ${i + 1}/${stocks.length}]`;

        console.log(`${progressStr} ${symbol}`);

        // 初始化状态
        await updateProgress('stock', i + 1, stocks.length, symbol, totalFixedSoFar, '正在扫描...');

        // 获取第一次交易日期
        let firstTradeDate = getStockFirstTradeDate(allTransactions, symbol);
        const today = format(new Date(), 'yyyy-MM-dd');

        // 🔥 冒烟测试：只检查最近 30 天
        if (SMOKE_TEST) {
            firstTradeDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
        }

        // 生成日期列表
        const dateRange = eachDayOfInterval({
            start: parseISO(firstTradeDate),
            end: parseISO(today)
        });

        // 只检查工作日
        const tradingDays = dateRange.filter(d => !isWeekend(d)).map(d => format(d, 'yyyy-MM-dd'));

        console.log(`   日期范围: ${firstTradeDate} 到 ${today} (${tradingDays.length} 个交易日)`);

        let fixed = 0;
        let skipped = 0;
        let failed = 0;

        for (const date of tradingDays) {
            const status = await checkEODStatus(symbol, date);

            if (status === 'clean') {
                // 正规数据，跳过
                skipped++;
                continue;
            }

            if (status === 'missing' || status === 'dirty') {
                // 需要修复
                const close = await fetchStockEOD(symbol, date);

                if (close !== null) {
                    const success = await writeEOD(symbol, date, close, 'polygon-master-backfill');
                    if (success) {
                        fixed++;
                        totalFixedSoFar++;
                        const msg = `${date} ($${close.toFixed(2)})`;
                        if (fixed <= 3) {
                            console.log(`      ✅ ${msg} ${status === 'dirty' ? '(覆盖脏数据)' : ''}`);
                        }
                        if (fixed % 5 === 0) {
                            await updateProgress('stock', i + 1, stocks.length, symbol, totalFixedSoFar, msg);
                        }
                    } else {
                        console.log(`      ❌ 写入失败: ${date}`);
                        failed++;
                    }
                } else {
                    // Polygon returned no data
                    console.log(`      ⚠️  Fetch失败 (可能休市): ${date}`);
                    failed++;
                }

                // 速率限制
                await sleep(RATE_LIMIT_MS);
            }
        }

        stats.stockFixed += fixed;
        stats.stockSkipped += skipped;
        stats.stockFailed += failed;

        // 完成一个股票后更新
        await updateProgress('stock', i + 1, stocks.length, symbol, totalFixedSoFar, `完成 (修: ${fixed}, 跳: ${skipped})`);

        console.log(`   📊 Fixed: ${fixed}, Skipped: ${skipped}, Failed: ${failed}\n`);
    }

    // ==========================================
    // 步骤 3: 处理期权 - 2年窗口限制
    // ==========================================
    console.log('🔧 步骤 3: 处理期权 - 2年窗口限制 (>= 2024-02-01)...');
    console.log('─────────────────────────────────────────────────────\n');

    for (let i = 0; i < options.length; i++) {
        const symbol = options[i];
        const progressStr = `[Option ${i + 1}/${options.length}]`;

        console.log(`${progressStr} ${symbol}`);

        // 初始状态
        await updateProgress('option', i + 1, options.length, symbol, totalFixedSoFar, '正在扫描...');

        // 检查是否合规
        if (!isOptionCompliant(symbol)) {
            console.log(`   ⏭️  SKIP: 过期日早于 ${OPTIONS_CUTOFF_DATE}（超出 2 年窗口）\n`);
            stats.optionTooOld++;
            continue;
        }

        // 获取交易日期范围
        let dateRange = getOptionTradeDateRange(symbol);
        if (!dateRange) {
            console.log(`   ❌ ERROR: 无法解析期权日期\n`);
            stats.optionFailed++;
            continue;
        }

        // 🔥 冒烟测试：只检查最近 30 天
        if (SMOKE_TEST) {
            const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
            if (dateRange.start < thirtyDaysAgo) {
                dateRange.start = thirtyDaysAgo;
            }
            // fix: 防止 start > end 导致报错
            if (dateRange.start > dateRange.end) {
                console.log(`   ⏭️  SKIP: 冒烟测试跳过 (过期日 ${dateRange.end} 早于最近30天)\n`);
                stats.optionSkipped++;
                continue;
            }
        }

        const tradingDays = eachDayOfInterval({
            start: parseISO(dateRange.start),
            end: parseISO(dateRange.end)
        }).filter(d => !isWeekend(d)).map(d => format(d, 'yyyy-MM-dd'));

        console.log(`   日期范围: ${dateRange.start} 到 ${dateRange.end} (${tradingDays.length} 个交易日)`);

        let fixed = 0;
        let skipped = 0;
        let failed = 0;

        for (const date of tradingDays) {
            const status = await checkEODStatus(symbol, date);

            if (status === 'clean') {
                skipped++;
                continue;
            }

            if (status === 'missing' || status === 'dirty') {
                // 修复 Missing 或 覆盖 Dirty
                const close = await fetchOptionEOD(symbol, date);

                if (close !== null) {
                    const success = await writeEOD(symbol, date, close, 'polygon-master-backfill-option');
                    if (success) {
                        fixed++;
                        totalFixedSoFar++;
                        const msg = `${date} ($${close.toFixed(2)})`;

                        if (fixed <= 3) {
                            console.log(`      ✅ ${msg} ${status === 'dirty' ? '(覆盖脏数据)' : ''}`);
                        }

                        // 实时更新状态
                        if (fixed % 5 === 0) {
                            await updateProgress('option', i + 1, options.length, symbol, totalFixedSoFar, msg);
                        }
                    } else {
                        failed++;
                    }
                } else {
                    // Polygon 无数据
                    if (status === 'dirty') {
                        // 如果是脏数据且 Polygon 无数据，必须删除脏数据，回归 Missing 状态
                        await db.collection('officialCloses').doc(`${date}_${symbol}`).delete();
                        console.log(`      🗑️ ${date} 已删除脏数据 (Polygon无数据)`);
                        fixed++; // 算作修复
                        totalFixedSoFar++;
                    } else {
                        // 原本就 Missing，保持 Missing
                        failed++;
                    }
                }

                await sleep(RATE_LIMIT_MS);
            } else if (status === 'clean') {
                // Clean 数据跳过
                skipped++;
            }
        }

        stats.optionFixed += fixed;
        stats.optionSkipped += skipped;
        stats.optionFailed += failed;

        // 完成一个期权后更新
        await updateProgress('option', i + 1, options.length, symbol, totalFixedSoFar, `完成 (修: ${fixed}, 跳: ${skipped})`);

        console.log(`   📊 Fixed: ${fixed}, Skipped: ${skipped}, Failed: ${failed}\n`);
    }

    // 最后更新一次完成状态
    await db.collection('system').doc('backfill_status').set({
        isActive: false, // 标记为已完成
        mode: 'done',
        current: stats.optionCount,
        total: stats.optionCount,
        progressPercent: 100,
        currentSymbol: 'ALL DONE',
        totalFixed: totalFixedSoFar,
        lastFixed: '全部修复完成',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // ==========================================
    // 步骤 4: 统计报告
    // ==========================================
    console.log('─────────────────────────────────────────────────────');
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║           📊 全量修复完成 - 统计报告               ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log(`总资产数: ${stats.totalSymbols}`);
    console.log(`├─ 股票: ${stats.stockCount}`);
    console.log(`└─ 期权: ${stats.optionCount}\n`);

    console.log(`📦 股票修复结果:`);
    console.log(`   ✅ 成功修复: ${stats.stockFixed}`);
    console.log(`   ⏭️  跳过(clean): ${stats.stockSkipped}`);
    console.log(`   ❌ 失败: ${stats.stockFailed}\n`);

    console.log(`📊 期权修复结果:`);
    console.log(`   ✅ 成功修复: ${stats.optionFixed}`);
    console.log(`   ⏭️  跳过(clean): ${stats.optionSkipped}`);
    console.log(`   ⏭️  跳过(too old): ${stats.optionTooOld}`);
    console.log(`   ❌ 失败/无数据: ${stats.optionFailed}\n`);

    const totalFixed = stats.stockFixed + stats.optionFixed;
    if (totalFixed > 0) {
        console.log('🎉 数据已写入 Firebase！刷新网页即可查看。');
    }

    console.log('\n✨ Master Backfill 执行完毕');
}

// ============================================
// 启动
// ============================================

main()
    .then(() => {
        console.log('\n✅ 脚本执行成功');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 脚本执行失败:', err);
        process.exit(1);
    });
