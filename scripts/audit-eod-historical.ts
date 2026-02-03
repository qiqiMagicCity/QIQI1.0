
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// --- NY-TIME 逻辑 (硬编码用于脚本独立性) ---
const US_MARKET_HOLIDAYS = new Set([
    '2022-01-17', '2022-02-21', '2022-04-15', '2022-05-30', '2022-06-20', '2022-07-04', '2022-09-05', '2022-11-24', '2022-12-26',
    '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07', '2023-05-29', '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
    '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
    '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'
]);

// 简单的 YYYY-MM-DD 交易日检查
function isNyTradingDay(dateStr: string): boolean {
    if (US_MARKET_HOLIDAYS.has(dateStr)) return false;
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay(); // 0=Sun, 6=Sat
    return day !== 0 && day !== 6;
}

function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

// 初始化 Firebase
if (!admin.apps.length) {
    try {
        const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS || '../../service-account.json');
        // 注意: 这里假设运行在正确环境，如果找不到凭证，通常会报错。
        // 为了 robustness，这里使用默认初始化 (通常在本地配置好了)
        admin.initializeApp();
    } catch (e) {
        // Fallback or ignore if already init
        if (!admin.apps.length) admin.initializeApp();
    }
}

const db = getFirestore();

// --- 辅助函数 ---
function getPath(obj: any, path: string) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function pickFirst<T = any>(obj: any, keys: string[]): T | undefined {
    for (const k of keys) {
        const v = k.includes('.') ? getPath(obj, k) : obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v as T;
    }
    return undefined;
}

interface NormTx {
    id: string;
    symbol: string;
    qty: number;
    ts: number;
    date: string; // YYYY-MM-DD
    assetType: 'stock' | 'option';
}

function normalizeFireTx(raw: any, source: string): NormTx | null {
    const symbolRaw = pickFirst<string>(raw, ['symbol', 'ticker', 'underlying', 'symbolRoot', 'optionDetails.symbol']);
    let symbol = symbolRaw != null ? String(symbolRaw).trim().toUpperCase() : '';

    if (!symbol) return null;

    // 清理 symbol 中的空格
    const cleanSym = symbol.replace(/\s+/g, '');

    // === 资产类型检测 ===
    // 强制规则：如果 Symbol 是 AAPB，强制视为 Stock，即使用户/系统标记为 Option
    if (cleanSym === 'AAPB') {
        return {
            id: raw.id,
            symbol: cleanSym,
            qty: Number(raw.qty || 0),
            ts: raw.transactionTimestamp || 0,
            date: new Date(raw.transactionTimestamp || 0).toISOString().slice(0, 10),
            assetType: 'stock'
        };
    }

    const isOcc = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(cleanSym);

    // 获取原始类型提示
    const atCand = (pickFirst<any>(raw, ['assetType', 'securityType', 'instrumentType']) ?? '').toString().toLowerCase();
    const rawTypeIsOption = atCand.includes('option') || (raw.type && raw.type.toLowerCase().includes('option'));

    let finalAssetType: 'stock' | 'option' = 'stock';

    if (isOcc) {
        finalAssetType = 'option';
    } else if (rawTypeIsOption) {
        finalAssetType = 'option';
    }

    // 我们只审计 Stock
    if (finalAssetType === 'option') return null;

    const qty = Number(raw.qty || 0);
    const ts = raw.transactionTimestamp || 0;
    const date = new Date(ts).toISOString().slice(0, 10);

    return {
        id: raw.id,
        symbol: cleanSym,
        qty,
        ts,
        date,
        assetType: 'stock'
    };
}

async function getAllStockTransactions(): Promise<Map<string, NormTx[]>> {
    console.log("正在拉取全量交易记录 (Stock Only, 包含 AAPB)...");
    const usersSnap = await db.collection('users').get();
    const grouped = new Map<string, NormTx[]>();

    for (const doc of usersSnap.docs) {
        const uid = doc.id;
        // 拉取 transactions 和 trades 两个集合
        const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
        const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();
        const allDocs = [...txSnap.docs, ...tradeSnap.docs];


        allDocs.forEach(d => {
            const t = normalizeFireTx({ ...d.data(), id: d.id }, 'tx');
            if (t) {
                if (!grouped.has(t.symbol)) grouped.set(t.symbol, []);
                grouped.get(t.symbol)!.push(t);
            }
        });
    }
    return grouped;
}

// 格式化日期范围输出
function summarizeDates(dates: string[]): string {
    if (dates.length === 0) return "";
    let ranges: string[] = [];
    let start = dates[0];
    let prev = dates[0];

    for (let i = 1; i < dates.length; i++) {
        const curr = dates[i];
        const dCurr = new Date(curr);
        const dPrev = new Date(prev);
        const diff = (dCurr.getTime() - dPrev.getTime()) / (1000 * 3600 * 24);

        // 如果中间间隔超过 3 天 (或者是连续的交易日断裂，这里简单用自然日判断连续性，主要是为了聚合展示)
        // 简单起见，如果日期不连续超过 1 天 (其实周末可能有 2-3 天间隔，这里为了视觉紧凑，我们只聚合真正的连续块或近距离块?
        // 用户的示例是: 2022-08-10 至 2023-05-01。
        // 我们还是用简单的断点聚合。如果 gap > 4 天认为是断开的 (考虑长周末)
        if (diff > 4) {
            if (start === prev) ranges.push(start);
            else ranges.push(`${start} 至 ${prev}`);
            start = curr;
        }
        prev = curr;
    }
    if (start === prev) ranges.push(start);
    else ranges.push(`${start} 至 ${prev}`);

    return ranges.join(', ');
}

async function main() {
    console.log("=== 核心逻辑修正：全量 EOD 审计 (历史持仓回放) ===");

    // 1. 获取所有 Stock 交易
    const txMap = await getAllStockTransactions();
    const sortedSymbols = Array.from(txMap.keys()).sort();
    console.log(`找到 ${sortedSymbols.length} 个潜在股票标的 (包含历史持仓)。`);

    const todayStr = new Date().toISOString().slice(0, 10);
    const globalMissingReport: Record<string, string[]> = {};

    // 2. 对每个 Symbol 进行生命周期回放
    for (const sym of sortedSymbols) {
        const txs = txMap.get(sym)!;
        // 按时间排序
        txs.sort((a, b) => a.ts - b.ts);

        // 构建每日变动 Map
        const deltaMap = new Map<string, number>();
        txs.forEach(t => {
            const d = t.date;
            deltaMap.set(d, (deltaMap.get(d) || 0) + t.qty);
        });

        const startDate = txs[0].date;
        const endDate = todayStr;

        // 回放
        let currentQty = 0;
        let currentDate = startDate;
        const datesNeedsPrice = new Set<string>();

        // 有效持仓日期区间记录 (用于 Report 里的 "交易周期")
        let firstHoldingDate = "";
        let lastHoldingDate = "";
        let hasHeld = false;

        while (currentDate <= endDate) {
            // 应用当日变动
            if (deltaMap.has(currentDate)) {
                currentQty += deltaMap.get(currentDate)!;
                // 浮点数修正
                currentQty = Math.round(currentQty * 100000) / 100000;
            }

            // 如果今日结束时持仓不为 0 (或者绝对值足够大)
            // 注意: 用于计算 PnL，只要持有，不论多空，都需要 EOD
            if (Math.abs(currentQty) > 0.0001) {
                if (!hasHeld) { firstHoldingDate = currentDate; hasHeld = true; }
                lastHoldingDate = currentDate;

                // 只有交易日需要 EOD (当然，有些系统可能周末也记，但通常是交易日)
                if (isNyTradingDay(currentDate)) {
                    datesNeedsPrice.add(currentDate);
                }
            } else {
                // 持仓为 0
            }

            // 下一天
            currentDate = addDays(currentDate, 1);
        }

        if (datesNeedsPrice.size === 0) {
            // 从未持有过? 或者只持有过非交易日?
            continue;
        }

        // 3. 缺口比对 (查 stocks/{symbol}/history)
        // 注意：history 可能是 huge 的，select('date') 减少传输
        const historySnap = await db.collection('stocks').doc(sym).collection('history')
            .select('date') // 假设文档里有 date 字段
            .get();

        const availableDates = new Set<string>();
        historySnap.forEach(d => {
            const data = d.data();
            // history 文档通常直接是 key=date 或者是字段 date?
            // 假设 data.date 存在
            if (data.date) availableDates.add(data.date);
            // 同时也检查 doc.id 是否是日期格式，以防万一
            if (/^\d{4}-\d{2}-\d{2}$/.test(d.id)) availableDates.add(d.id);
        });

        // 查找缺失
        const missingForSym: string[] = [];
        for (const reqDate of datesNeedsPrice) {
            if (!availableDates.has(reqDate)) {
                missingForSym.push(reqDate);
            }
        }

        if (missingForSym.length > 0) {
            missingForSym.sort();
            // 记录报告
            globalMissingReport[sym] = missingForSym;

            // 实时打印每个标的的简报 (为了让用户感觉 "立即输出")
            console.log(`\n[审计中] ${sym}`);
            console.log(`   交易周期: ${firstHoldingDate} 至 ${lastHoldingDate}`);
            console.log(`   🔴 发现缺失 EOD: ${missingForSym.length} 天`);
        }
    }

    // 4. 最终输出清单
    console.log("\n============================================");
    console.log("            [历史数据缺口报告]              ");
    console.log("============================================");

    const symbolsWithGaps = Object.keys(globalMissingReport).sort();

    if (symbolsWithGaps.length === 0) {
        console.log("✅ 完美！所有历史持仓日期的 EOD 数据均完整 (stocks/{symbol}/history)。");
    } else {
        for (const sym of symbolsWithGaps) {
            const dates = globalMissingReport[sym];
            const ranges = summarizeDates(dates);

            // 为了获取交易周期 (again, easy implementation: min/max of dates?) 
            // 上面 loop 里其实计算了，这里为了简化直接输出 gaps
            console.log(`\n标的: ${sym}`);
            // console.log(`交易周期: ...`); // (可选优化: 把上面的周期存下来这里打印)
            console.log(`🔴 缺失 EOD: ${ranges} (共 ${dates.length} 天)`);
            console.log(`(请运行 yarn fix-eod-gaps ${sym} 或类似脚本进行修复)`);
        }
    }
    console.log("\n============================================");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
