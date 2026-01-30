import { toNyCalendarDayString } from '@/lib/ny-time';

export interface SplitEvent {
    symbol: string;        // 原始股票代码
    effectiveDate: string; // 生效日期，NY 交易日 'YYYY-MM-DD'（从这一天开盘起按新股数口径）
    splitRatio: number;    // 拆分比例（new_shares_per_old_share，新股数 / 旧股数）
}

// —— 拆分配置表（暂时用前端常量，后续可迁移到 Firestore 配置） ——
// —— 拆分配置表（此为硬编码回退表，系统优先加载 DB 配置） ——
export const DEFAULT_STOCK_SPLITS: SplitEvent[] = [
    // NFLX（Netflix 奈飞）：1 拆 10，自 2025-11-17（周一，美东开盘）起生效
    { symbol: 'NFLX', effectiveDate: '2025-11-17', splitRatio: 10 },
    // NVDA (Nvidia): 10-for-1 split, effective June 7, 2024
    { symbol: 'NVDA', effectiveDate: '2024-06-07', splitRatio: 10 },
    // TSLA (Tesla): 3-for-1 split, effective August 25, 2022
    { symbol: 'TSLA', effectiveDate: '2022-08-25', splitRatio: 3 },
    // NFLX (Netflix): 7-for-1 split, effective July 15, 2015
    { symbol: 'NFLX', effectiveDate: '2015-07-15', splitRatio: 7 },
];

export const STOCK_SPLITS = DEFAULT_STOCK_SPLITS; // 保持兼容性

// —— 内部分组用 symbol 规范化：去空格，NFKC，统一大写 —— 
const normalizeSymbolForGrouping = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

// —— 拆分辅助：针对单笔交易，计算“从交易当日到当前口径”的累积拆分因子 ——
// 设计逻辑：
// - effectiveDate（生效日）表示“从这一天开盘开始，市场价格/数量都使用新口径”；
// - 所以：对于交易日 < effectiveDate 的历史交易，需要乘上所有后续拆分的 splitRatio；
// - 对于交易日 >= effectiveDate 的交易，认为已经在新口径上，不再调整。
// - targetDate: 如果指定，则只考虑 effectiveDate <= targetDate 的拆分事件。
//   用于构建“历史时刻”的快照（例如计算上月月底的持仓时，不应包含本月的拆分）。
export function getCumulativeSplitFactor(
    symbolRaw: string,
    txTimestamp: number,
    targetDate?: string,
    activeSplits: SplitEvent[] = DEFAULT_STOCK_SPLITS
): number {
    if (!symbolRaw || !Number.isFinite(txTimestamp)) return 1;

    const normalizedSymbol = normalizeSymbolForGrouping(symbolRaw);
    const txDay = toNyCalendarDayString(txTimestamp);
    if (!txDay) return 1;

    let factor = 1;

    for (const ev of activeSplits) {
        const evSymbolNorm = normalizeSymbolForGrouping(ev.symbol);
        if (evSymbolNorm !== normalizedSymbol) continue;

        // 如果指定了 targetDate，且拆分生效日晚于 targetDate，则忽略该拆分
        // (即：我们在 targetDate 时还不知道这个拆分，或者它还没发生)
        if (targetDate && ev.effectiveDate > targetDate) continue;

        if (
            txDay < ev.effectiveDate &&
            typeof ev.splitRatio === 'number' &&
            Number.isFinite(ev.splitRatio) &&
            ev.splitRatio > 0
        ) {
            factor *= ev.splitRatio; // [FIX] Field name might vary if from DB? Assumed mapped to SplitEvent interface
        }
    }

    return factor;
}

// —— 拆分辅助：根据日期直接计算复权因子（用于修正 EOD 价格） ——
// 针对 EOD 数据通常是“全面复权”（Adjusted Close）的情况：
// 如果查询的日期在拆分生效日之前，意味着当时的真实价格（和我们当时持有的股数）是“未拆分”的状态。
// 但 EOD 价格是“已拆分”的低价。
// 因此，我们需要乘以拆分比例，将 EOD 价格还原为当时的“原始价格”，以便与当时的持仓数量（低数量）匹配。
export function getSplitFactorForDate(
    symbolRaw: string,
    dateString: string,
    activeSplits: SplitEvent[] = DEFAULT_STOCK_SPLITS
): number {
    if (!symbolRaw || !dateString) return 1;

    const normalizedSymbol = normalizeSymbolForGrouping(symbolRaw);
    let factor = 1;

    for (const ev of activeSplits) {
        const evSymbolNorm = normalizeSymbolForGrouping(ev.symbol);
        if (evSymbolNorm !== normalizedSymbol) continue;

        // 如果 当前日期 < 拆分生效日，说明相对于“现在/最新数据”，该日期处于“过去”，
        // 当时的实际价格应该比现在的复权价格高，所以需要乘回来。
        if (
            dateString < ev.effectiveDate &&
            typeof ev.splitRatio === 'number' &&
            Number.isFinite(ev.splitRatio) &&
            ev.splitRatio > 0
        ) {
            factor *= ev.splitRatio;
        }
    }
    return factor;
}

/**
 * [STANDARD] 标准化的获取历史真实价格的函数
 * 所有涉及“使用 EOD 价格计算历史持仓盈亏”的地方，必须使用此函数，禁止直接使用 eod.close。
 * 
 * 原因：
 * EOD 数据通常是 Adjusted Close（复权后价格，即今日口径）。
 * 但我们的历史持仓快照是当时的“原始股数”（Historical Shares，即当时口径）。
 * 为了计算匹配，必须将 EOD 价格“还原”回当时的“原始价格”。
 * 
 * 公式：RestoredPrice = AdjustedEodPrice * CumulativeSplitFactor
 */
export function getRestoredHistoricalPrice(
    adjustedClose: number,
    symbol: string,
    date: string,
    activeSplits: SplitEvent[] = DEFAULT_STOCK_SPLITS
): number {
    if (!adjustedClose) return 0;
    const factor = getSplitFactorForDate(symbol, date, activeSplits);
    return adjustedClose * factor;
}
