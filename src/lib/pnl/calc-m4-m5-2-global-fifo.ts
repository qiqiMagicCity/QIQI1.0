// src/lib/pnl/calc-m4-m5-2-global-fifo.ts
// M4 & M5.2: 全局 FIFO 算法 - 同时计算 M4 和 M5.2
import { Tx } from '@/hooks/use-user-transactions';
import { toNyCalendarDayString } from '@/lib/ny-time';
import { getCumulativeSplitFactor } from '@/lib/holdings/stock-splits';

const normalizeSymbolForClient = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

export type GlobalFifoInput = {
    transactions: Tx[];
    todayNy: string;
    periodStarts?: {
        wtd: string; // YYYY-MM-DD
        mtd: string; // YYYY-MM-DD
        ytd: string; // YYYY-MM-DD
    };
};

export interface PnLEvent {
    date: string; // YYYY-MM-DD
    pnl: number;
}

export interface AuditEvent {
    symbol: string;
    openDate: string;
    openPrice: number;
    closeDate: string;
    closePrice: number;
    qty: number;
    pnl: number;
    multiplier: number;
}

export type GlobalFifoResult = {
    m4: number;  // 今日平仓盈利（历史仓位）
    m5_2: number; // 今日平仓盈利（今日仓位）
    totalRealizedPnl: number; // M9: 历史总已实现盈亏
    winCount: number; // M10: 盈利批次
    lossCount: number; // M10: 亏损批次
    pnlEvents: PnLEvent[]; // [NEW] 所有已实现盈亏事件，供 M11-M13 使用
    auditTrail: AuditEvent[]; // [NEW] Detailed ledger for debugging
};

/**
 * 计算 M4 和 M5.2: 全局 FIFO
 * M4: 今日卖出配对到历史买入的盈亏
 * M5.2: 今日卖出配对到今日买入的盈亏
 * 
 * @param input.transactions - 所有交易记录
 * @param input.todayNy - 今日纽约交易日 (YYYY-MM-DD)
 * @returns M4, M5.2, TotalRealizedPnl, WinCount, LossCount, PnLEvents, AuditTrail
 */
export function calcGlobalFifo(input: GlobalFifoInput): GlobalFifoResult {
    const { transactions, todayNy } = input;

    if (!Array.isArray(transactions) || transactions.length === 0) {
        return {
            m4: 0, m5_2: 0,
            totalRealizedPnl: 0, winCount: 0, lossCount: 0,
            pnlEvents: [],
            auditTrail: []
        };
    }

    const sortedAllTx = [...transactions].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);
    const globalQueues = new Map<string, Array<{ qty: number; cost: number; date: string }>>();

    let m5_2 = 0;
    let m4 = 0;
    let totalRealizedPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    const pnlEvents: PnLEvent[] = [];
    const auditTrail: AuditEvent[] = [];

    for (const tx of sortedAllTx) {
        const key = tx.contractKey || normalizeSymbolForClient(tx.symbol);
        if (!globalQueues.has(key)) globalQueues.set(key, []);
        const queue = globalQueues.get(key)!;

        // [FIX] Ignore explicit SPLIT transactions to avoid double counting or treating as BUY
        if (tx.opKind === 'SPLIT') continue;

        const txDate = toNyCalendarDayString(tx.transactionTimestamp);

        // [FIX] Apply Stock Split Adjustment
        const splitFactor = getCumulativeSplitFactor(tx.symbol, tx.transactionTimestamp);
        const adjQty = tx.qty * splitFactor;
        const adjPrice = tx.price / splitFactor;
        const adjMultiplier = tx.multiplier; // Multiplier usually doesn't change in stock split, but for options it might. Assuming stock split here.

        let remainingQty = adjQty;

        while (remainingQty !== 0) {
            if (queue.length === 0) {
                // 没有持仓可配对,直接入队
                queue.push({ qty: remainingQty, cost: adjPrice, date: txDate });
                remainingQty = 0;
            } else {
                const head = queue[0];
                const headSign = Math.sign(head.qty);
                const txSign = Math.sign(remainingQty);

                if (headSign === txSign) {
                    // 同向,直接入队
                    queue.push({ qty: remainingQty, cost: adjPrice, date: txDate });
                    remainingQty = 0;
                } else {
                    // 反向配对,产生平仓
                    const matchQty = Math.min(Math.abs(remainingQty), Math.abs(head.qty));

                    // 计算PnL
                    let pnl = 0;
                    if (headSign > 0) {
                        // 平多: Sell Price - Buy Cost
                        pnl = (adjPrice - head.cost) * matchQty * adjMultiplier;
                    } else {
                        // 平空: Short Cost - Cover Price
                        pnl = (head.cost - adjPrice) * matchQty * adjMultiplier;
                    }

                    // Record Audit Event
                    auditTrail.push({
                        symbol: tx.symbol,
                        openDate: head.date,
                        openPrice: head.cost,
                        closeDate: txDate,
                        closePrice: adjPrice,
                        qty: matchQty,
                        pnl,
                        multiplier: adjMultiplier
                    });

                    // M9: 累加历史总已实现盈亏
                    totalRealizedPnl += pnl;

                    // M10: 统计胜率 (按批次)
                    if (pnl > 0.0001) winCount++;
                    else if (pnl < -0.0001) lossCount++;

                    // [NEW] 记录盈亏事件
                    pnlEvents.push({ date: txDate, pnl });

                    // M4/M5.2: 今日盈亏归因
                    if (txDate === todayNy) {
                        if (head.date === todayNy) {
                            m5_2 += pnl;
                        } else {
                            m4 += pnl;
                        }
                    }

                    // 更新队列
                    if (Math.abs(head.qty) > matchQty) {
                        head.qty = head.qty > 0 ? head.qty - matchQty : head.qty + matchQty;
                        remainingQty = remainingQty > 0 ? remainingQty - matchQty : remainingQty + matchQty;
                    } else {
                        queue.shift();
                        remainingQty = remainingQty > 0 ? remainingQty - matchQty : remainingQty + matchQty;
                        if (Math.abs(remainingQty) < 0.000001) remainingQty = 0;
                    }
                }
            }
        }
    }

    return { m4, m5_2, totalRealizedPnl, winCount, lossCount, pnlEvents, auditTrail };
}
