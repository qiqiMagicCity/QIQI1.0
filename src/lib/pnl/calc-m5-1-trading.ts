// src/lib/pnl/calc-m5-1-trading.ts
// M5: 三桶模型 (Three Buckets Model) - 纯净日内交易视角
// 规则：
// 1. M5 = 当日闭环已实现盈亏 + 今日净新开仓浮动盈亏
// 2. 排除项：单纯减历史底仓但当日未买回/卖回形成闭环的部分，不计入 M5。

import { Tx } from '@/hooks/use-user-transactions';
import { toNyCalendarDayString } from '@/lib/ny-time';
import { PriceRecord } from '@/price/RealTimePricesProvider';
import { getCumulativeSplitFactor } from '@/lib/holdings/stock-splits';
import { AuditEvent } from './calc-m4-m5-2-global-fifo';

const normalizeSymbolForClient = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

export type M5_1_Input = {
    transactions: Tx[];
    todayNy: string;
    currentPrices?: Map<string, PriceRecord>;
};

export type M5_1_Result = {
    m5_1: number;
    realized: number;
    unrealized: number;
    breakdown: Map<string, { realized: number; unrealized: number }>;
    auditTrail: AuditEvent[];
};

type BucketItem = {
    qty: number;
    price: number;
    multiplier: number;
};

export function calcM5_1_Trading(input: M5_1_Input): M5_1_Result {
    const { transactions, todayNy, currentPrices } = input;

    if (!Array.isArray(transactions) || transactions.length === 0) {
        return { m5_1: 0, realized: 0, unrealized: 0, breakdown: new Map(), auditTrail: [] };
    }

    // 1. 数据分流：历史 vs 今日
    const histTxs: Tx[] = [];
    const todayTxs: Tx[] = [];

    // 预处理：按时间排序，确保计算 S0 和回放今日交易的顺序正确
    const sortedTxs = [...transactions].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    for (const tx of sortedTxs) {
        const txDate = toNyCalendarDayString(tx.transactionTimestamp);
        if (txDate < todayNy) {
            histTxs.push(tx);
        } else if (txDate === todayNy) {
            todayTxs.push(tx);
        }
        // Future txs ignored
    }

    if (todayTxs.length === 0) {
        return { m5_1: 0, realized: 0, unrealized: 0, breakdown: new Map(), auditTrail: [] };
    }

    const breakdown = new Map<string, { realized: number; unrealized: number }>();
    const auditTrail: AuditEvent[] = [];
    let totalRealized = 0;
    let totalUnrealized = 0;

    // Helper to update breakdown
    const addBreakdown = (sym: string, type: 'realized' | 'unrealized', val: number) => {
        const item = breakdown.get(sym) || { realized: 0, unrealized: 0 };
        item[type] += val;
        breakdown.set(sym, item);
    };

    // 2. 按标的分组处理
    // 找出所有涉及的标的（今日有交易的）
    const activeSymbols = new Set<string>();
    todayTxs.forEach(tx => activeSymbols.add(normalizeSymbolForClient(tx.symbol)));

    // 计算 S0 (Start of Day Position) for active symbols
    // 需要考虑 Split 对 S0 的影响，确保 Qty 是今天的标准
    // S0 计算逻辑：遍历历史交易，对每一笔：qty * splitFactor(uptoToday) ? 
    // 更准确做法：累加 qty 时，如果遇到 SPLIT op，则调整当前累加值。
    // 或者：使用 adjustQty = tx.qty * getFactor(txTs, Now)
    // 这里使用简化逻辑：假设 transactions 里的 split 已经处理？不，transaction是原始的。
    // 我们使用 getCumulativeSplitFactor(symbol, txTs) 获取该笔交易到**现在**的拆股倍数。
    // 这样 S0 就是“按今日股数标准调整后的昨日持仓”。

    const s0Map = new Map<string, number>();

    // 优化：只计算 activeSymbols 的 S0
    // 但历史交易混杂，只能遍历一遍历史
    for (const tx of histTxs) {
        if (tx.opKind === 'SPLIT') continue; // Split txn usually handled via factor function

        const sym = normalizeSymbolForClient(tx.symbol);
        if (!activeSymbols.has(sym)) continue;

        const factor = getCumulativeSplitFactor(tx.symbol, tx.transactionTimestamp);
        const adjQty = tx.qty * factor;

        const current = s0Map.get(sym) || 0;
        s0Map.set(sym, current + adjQty);
    }

    // 3. 逐个标的运行“三桶模型”
    for (const sym of Array.from(activeSymbols)) {
        const s0 = s0Map.get(sym) || 0;
        const symTxs = todayTxs.filter(t => normalizeSymbolForClient(t.symbol) === sym); // Already sorted

        // 状态变量
        let remainingBase = s0; // 剩余可用的底仓（正负）

        // Buckets
        const C_long_reduce: BucketItem[] = [];  // S0>0, Sell 进这里
        const C_short_reduce: BucketItem[] = []; // S0<0, Buy 进这里
        const A_long: BucketItem[] = [];         // 日内新多
        const A_short: BucketItem[] = [];        // 日内新空

        for (const tx of symTxs) {
            if (tx.opKind === 'SPLIT') continue;

            const factor = 1; // 今日交易无需调整（本身就是今日标准）
            const qty = Math.abs(tx.qty);
            const price = tx.price;
            const mult = tx.multiplier;
            const side = tx.qty > 0 ? 'BUY' : 'SELL'; // explicitly strictly based on qty sign

            let qtyRemaining = qty;

            if (side === 'BUY') {
                // BUY 流程 - 优先闭环今日操作 (A/C Buys), 然后才去减历史空头底仓

                // (1) 匹配 C_long_reduce (做T闭环：卖出的底仓买回)
                while (qtyRemaining > 0.000001 && C_long_reduce.length > 0) {
                    const matchLeg = C_long_reduce[0];
                    const matched = Math.min(qtyRemaining, matchLeg.qty);

                    // PnL = (SellPrice - CurrentBuyPrice)
                    const pnl = (matchLeg.price - price) * matched * mult;
                    totalRealized += pnl;
                    addBreakdown(sym, 'realized', pnl);

                    auditTrail.push({
                        symbol: sym,
                        openDate: "Historical", // C bucket is legacy
                        openPrice: matchLeg.price,
                        closeDate: todayNy,
                        closePrice: price,
                        qty: matched, // matched is positive. Since this is long reduce (Sell), effectively selling.
                        pnl,
                        multiplier: mult
                    });

                    // Update Queues
                    matchLeg.qty -= matched;
                    if (matchLeg.qty <= 0.000001) C_long_reduce.shift();
                    qtyRemaining -= matched;
                }

                // (2) 匹配 A_short (平掉日内新空)
                while (qtyRemaining > 0.000001 && A_short.length > 0) {
                    const matchLeg = A_short[0];
                    const matched = Math.min(qtyRemaining, matchLeg.qty);

                    // PnL = (EntrySellPrice - CurrentBuyPrice)
                    const pnl = (matchLeg.price - price) * matched * mult;
                    totalRealized += pnl;
                    addBreakdown(sym, 'realized', pnl);

                    auditTrail.push({
                        symbol: sym,
                        openDate: todayNy, // A bucket is today
                        openPrice: matchLeg.price,
                        closeDate: todayNy,
                        closePrice: price,
                        qty: matched,
                        pnl,
                        multiplier: mult
                    });

                    matchLeg.qty -= matched;
                    if (matchLeg.qty <= 0.000001) A_short.shift();
                    qtyRemaining -= matched;
                }

                // (3) 减少历史空头底仓 (回补)
                // 条件：remainingBase < 0 (也就是还有空头底仓没补完)
                if (qtyRemaining > 0.000001 && remainingBase < 0) {
                    // 能回补多少？
                    // remainingBase is negative, e.g. -500. 
                    // We can cover min(qty, |-500|).
                    const canCover = Math.min(qtyRemaining, Math.abs(remainingBase));

                    if (canCover > 0) {
                        // 进 C_short_reduce
                        C_short_reduce.push({ qty: canCover, price, multiplier: mult });
                        remainingBase += canCover; // -500 + 100 = -400
                        qtyRemaining -= canCover;
                    }
                }

                // (4) 剩余 BUY 进 A_long
                if (qtyRemaining > 0.000001) {
                    A_long.push({ qty: qtyRemaining, price, multiplier: mult });
                }

            } else {
                // SELL 流程 - 优先闭环今日操作 (A/C Sells), 然后才去减历史多头底仓

                // (1) 匹配 C_short_reduce (做T闭环：回补的空头再卖出)
                while (qtyRemaining > 0.000001 && C_short_reduce.length > 0) {
                    const matchLeg = C_short_reduce[0];
                    const matched = Math.min(qtyRemaining, matchLeg.qty);

                    const pnl = (price - matchLeg.price) * matched * mult;
                    totalRealized += pnl;
                    addBreakdown(sym, 'realized', pnl);

                    auditTrail.push({
                        symbol: sym,
                        openDate: "Historical", // C Short bucket
                        openPrice: matchLeg.price,
                        closeDate: todayNy,
                        closePrice: price,
                        qty: matched,
                        pnl,
                        multiplier: mult
                    });

                    matchLeg.qty -= matched;
                    if (matchLeg.qty <= 0.000001) C_short_reduce.shift();
                    qtyRemaining -= matched;
                }

                // (2) 匹配 A_long (平掉日内新多)
                while (qtyRemaining > 0.000001 && A_long.length > 0) {
                    const matchLeg = A_long[0];
                    const matched = Math.min(qtyRemaining, matchLeg.qty);

                    const pnl = (price - matchLeg.price) * matched * mult;
                    totalRealized += pnl;
                    addBreakdown(sym, 'realized', pnl);

                    auditTrail.push({
                        symbol: sym,
                        openDate: todayNy, // A Long bucket
                        openPrice: matchLeg.price,
                        closeDate: todayNy,
                        closePrice: price,
                        qty: matched,
                        pnl,
                        multiplier: mult
                    });

                    matchLeg.qty -= matched;
                    if (matchLeg.qty <= 0.000001) A_long.shift();
                    qtyRemaining -= matched;
                }

                // (3) 减少历史多头底仓
                // 条件：remainingBase > 0
                if (qtyRemaining > 0.000001 && remainingBase > 0) {
                    const canReduce = Math.min(qtyRemaining, remainingBase);

                    if (canReduce > 0) {
                        // 进 C_long_reduce
                        C_long_reduce.push({ qty: canReduce, price, multiplier: mult });
                        remainingBase -= canReduce;
                        qtyRemaining -= canReduce;
                    }
                }

                // (4) 剩余 SELL 进 A_short (日内新空)
                if (qtyRemaining > 0.000001) {
                    A_short.push({ qty: qtyRemaining, price, multiplier: mult });
                }
            }
        } // end tx loop

        // 4. 计算该标的的浮动盈亏 (Unrealized)
        // 只看 A_long 和 A_short
        // C buckets ignored (pending base reduction)

        let symUnrealized = 0;

        // Need Mark Price
        // key logic: usually symbol, but sometimes contract key.
        // Assuming 'sym' is the normalized symbol.
        if (currentPrices) {
            const priceRec = currentPrices.get(sym);
            if (priceRec && typeof priceRec.price === 'number') {
                const mark = priceRec.price;

                // A_long: Long positions. Float = (Mark - Entry)
                for (const pos of A_long) {
                    const pnl = (mark - pos.price) * pos.qty * pos.multiplier;
                    symUnrealized += pnl;
                    auditTrail.push({
                        symbol: sym,
                        openDate: todayNy,
                        openPrice: pos.price,
                        closeDate: "HOLDING", // Unrealized
                        closePrice: mark,
                        qty: pos.qty,
                        pnl,
                        multiplier: pos.multiplier
                    });
                }

                // A_short: Short positions. Float = (Entry - Mark)
                for (const pos of A_short) {
                    const pnl = (pos.price - mark) * pos.qty * pos.multiplier;
                    symUnrealized += pnl;
                    auditTrail.push({
                        symbol: sym,
                        openDate: todayNy,
                        openPrice: pos.price,
                        closeDate: "HOLDING", // Unrealized
                        closePrice: mark,
                        qty: pos.qty,
                        pnl,
                        multiplier: pos.multiplier
                    });
                }
            }
        }

        if (Math.abs(symUnrealized) > 0.001) {
            totalUnrealized += symUnrealized;
            addBreakdown(sym, 'unrealized', symUnrealized);
        }

    } // end symbol loop

    const m5_1 = totalRealized + totalUnrealized;

    return {
        m5_1,
        realized: totalRealized,
        unrealized: totalUnrealized,
        breakdown,
        auditTrail
    };
}
