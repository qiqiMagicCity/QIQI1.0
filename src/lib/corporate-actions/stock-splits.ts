// src/lib/corporate-actions/stock-splits.ts
// 股票拆分配置（Stock Split Table，股票拆分配置表）
// 用于描述每个标的在什么日期发生过怎样的股票拆分。

import { toNyCalendarDayString } from '@/lib/ny-time';

// —— 拆分事件结构 ——
// ratio（拆分比例）：新股数 / 旧股数
// 例：1 股拆成 10 股 → ratio = 10；10 股并成 1 股（反向拆分，Reverse Split）→ ratio = 0.1
export interface StockSplit {
  symbol: string;        // 原始股票代码（不区分大小写，有空格也没关系）
  effectiveDate: string; // 生效交易日（纽约交易日，NY Trading Day，格式 "YYYY-MM-DD"）
  ratio: number;         // 拆分比例（新股数 / 旧股数）
}

// —— 用户可维护的拆分配置表（User Editable Table，用户可编辑区域） ——
// 说明：
// 1. 这里是全局“真相表”，所有计算都会参考这一份；
// 2. 你只需要在这里按需要添加你遇到的拆分事件即可；
// 3. 示例写法见注释。
const STOCK_SPLITS_RAW: StockSplit[] = [
  // 示例（请按实际情况填写）：
  // { symbol: 'AAPL', effectiveDate: '2020-08-31', ratio: 4 },   // 苹果 1→4 拆分
  // { symbol: 'TSLA', effectiveDate: '2020-08-31', ratio: 5 },   // 特斯拉 1→5 拆分
];

// —— 内部使用：统一规范 symbol（NFKC，去空格，大写） ——
const normalizeSymbolForSplits = (s: string): string =>
  (s ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();

// —— 预构建：按 symbol 归类 + 按 effectiveDate 排序 ——
// 说明：
// - key：规范化后的 symbol（大写无空格）；
// - value：按生效日期从小到大排序的拆分事件列表。
const SPLITS_BY_SYMBOL: Record<string, StockSplit[]> = {};

for (const item of STOCK_SPLITS_RAW) {
  if (!item.symbol || !item.effectiveDate) continue;
  if (typeof item.ratio !== 'number' || !Number.isFinite(item.ratio) || item.ratio <= 0) {
    // 非法 ratio，跳过，不让它污染计算
    continue;
  }
  const norm = normalizeSymbolForSplits(item.symbol);
  if (!SPLITS_BY_SYMBOL[norm]) SPLITS_BY_SYMBOL[norm] = [];
  // 这里把 symbol 也规范化存进去，避免后面混用
  SPLITS_BY_SYMBOL[norm].push({
    symbol: norm,
    effectiveDate: item.effectiveDate,
    ratio: item.ratio,
  });
}

// 按日期升序排序（早 → 晚）
for (const key of Object.keys(SPLITS_BY_SYMBOL)) {
  SPLITS_BY_SYMBOL[key].sort((a, b) => {
    if (a.effectiveDate < b.effectiveDate) return -1;
    if (a.effectiveDate > b.effectiveDate) return 1;
    return 0;
  });
}

// —— 对外 API（External API，对外工具函数） ——

// 获取某个标的的所有拆分事件（已按日期排序）
export function getSplitsForSymbol(rawSymbol: string): StockSplit[] {
  const norm = normalizeSymbolForSplits(rawSymbol);
  const list = SPLITS_BY_SYMBOL[norm] ?? [];
  // 返回浅拷贝，避免外部无意修改内部表
  return [...list];
}

// 判断某个标的是否曾经发生过拆分（只看配置表）
export function hasSplitsForSymbol(rawSymbol: string): boolean {
  const norm = normalizeSymbolForSplits(rawSymbol);
  const list = SPLITS_BY_SYMBOL[norm];
  return Array.isArray(list) && list.length > 0;
}

// 计算“从某个成交日到当前最新口径”的累计拆分因子（Cumulative Split Factor，累积拆分因子）
// 用途：
// - 在 FIFO 持仓计算前，把历史交易统一转换到“当前股数口径”；
// 算法：
// - 对于该 symbol 的所有拆分事件中，凡是 effectiveDate > txDay（成交日）
//   都参与累乘：factor *= ratio。
export function getCumulativeSplitFactorForTx(
  rawSymbol: string,
  txTimestamp: number,
): number {
  if (!Number.isFinite(txTimestamp) || txTimestamp <= 0) return 1;

  const txDay = toNyCalendarDayString(txTimestamp);
  if (!txDay) return 1;

  const norm = normalizeSymbolForSplits(rawSymbol);
  const splits = SPLITS_BY_SYMBOL[norm];
  if (!splits || splits.length === 0) return 1;

  let factor = 1;
  for (const s of splits) {
    // 成交日早于拆分生效日 → 需要按该拆分进行调整
    if (txDay < s.effectiveDate) {
      factor *= s.ratio;
    }
  }

  if (!Number.isFinite(factor) || factor <= 0) {
    // 守卫：如果因为配置错误导致 factor 非法，直接退回 1，防止把系统算崩
    return 1;
  }

  return factor;
}
