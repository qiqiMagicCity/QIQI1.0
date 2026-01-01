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
    openPositions: Map<string, Array<{ qty: number; cost: number; date: string; multiplier: number }>>; // [NEW] 当前持仓队列，用于计算持仓均价
};

/**
 * 计算 M4 和 M5.2: 全局 FIFO
 * ...
 */
export function calcGlobalFifo(input: GlobalFifoInput): GlobalFifoResult {
    const { transactions, todayNy } = input;

    if (!Array.isArray(transactions) || transactions.length === 0) {
        return {
            m4: 0, m5_2: 0,
            totalRealizedPnl: 0, winCount: 0, lossCount: 0,
            pnlEvents: [],
            auditTrail: [],
            openPositions: new Map()
        };
    }

    // [REVERT] Use subtraction for numeric timestamps
    const sortedAllTx = [...transactions].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);
    const globalQueues = new Map<string, Array<{ qty: number; cost: number; date: string; multiplier: number }>>();

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
        const adjMultiplier = tx.multiplier;

        let remainingQty = adjQty;

        while (remainingQty !== 0) {
            if (queue.length === 0) {
                queue.push({ qty: remainingQty, cost: adjPrice, date: txDate, multiplier: adjMultiplier });
                remainingQty = 0;
            } else {
                const head = queue[0];
                const headSign = Math.sign(head.qty);
                const txSign = Math.sign(remainingQty);

                if (headSign === txSign) {
                    queue.push({ qty: remainingQty, cost: adjPrice, date: txDate, multiplier: adjMultiplier });
                    remainingQty = 0;
                } else {
                    const matchQty = Math.min(Math.abs(remainingQty), Math.abs(head.qty));

                    let pnl = 0;
                    if (headSign > 0) {
                        pnl = (adjPrice - head.cost) * matchQty * adjMultiplier;
                    } else {
                        pnl = (head.cost - adjPrice) * matchQty * adjMultiplier;
                    }

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

                    totalRealizedPnl += pnl;

                    if (pnl > 0.0001) winCount++;
                    else if (pnl < -0.0001) lossCount++;

                    pnlEvents.push({ date: txDate, pnl });

                    if (txDate === todayNy) {
                        if (head.date === todayNy) {
                            m5_2 += pnl;
                        } else {
                            m4 += pnl;
                        }
                    }

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

    return { m4, m5_2, totalRealizedPnl, winCount, lossCount, pnlEvents, auditTrail, openPositions: globalQueues };
}
