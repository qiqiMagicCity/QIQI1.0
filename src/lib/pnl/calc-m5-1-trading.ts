// src/lib/pnl/calc-m5-1-trading.ts
// M5.1: 日内交易视角 - 今日买卖配对的盈亏（Intraday FIFO）
import { Tx } from '@/hooks/use-user-transactions';
import { toNyCalendarDayString, toNyHm } from '@/lib/ny-time';

const normalizeSymbolForClient = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

export type M5_1_Input = {
    transactions: Tx[];
    todayNy: string;
};

export type M5_1_Result = {
    m5_1: number;
};

/**
 * 计算 M5.1: 日内交易视角
 * 仅统计今日内买卖配对产生的盈亏
 * 
 * @param input.transactions - 所有交易记录
 * @param input.todayNy - 今日纽约交易日 (YYYY-MM-DD)
 * @returns M5.1 盈亏金额
 */
export function calcM5_1_Trading(input: M5_1_Input): M5_1_Result {
    const { transactions, todayNy } = input;

    if (!Array.isArray(transactions) || transactions.length === 0) {
        return { m5_1: 0 };
    }

    console.log(`[M5.1] Today: ${todayNy}, Total Txs: ${transactions.length}`);

    // 筛选今日交易
    const todayTxs = transactions.filter(tx =>
        toNyCalendarDayString(tx.transactionTimestamp) === todayNy
    ).sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    console.log(`[M5.1] Today's Txs: ${todayTxs.length}`);

    // Debug: Log all today's transactions
    todayTxs.forEach((tx, idx) => {
        const direction = tx.qty > 0 ? 'BUY' : 'SELL';
        const time = toNyHm(tx.transactionTimestamp);
        console.log(`[M5.1] Tx${idx + 1}: ${time} ${direction} ${Math.abs(tx.qty)} ${tx.symbol} @${tx.price} (ID:${tx.id.substring(0, 8)}...)`);
    });

    let m5_1 = 0;

    // 日内 FIFO 队列
    const intradayQueues = new Map<string, Array<{ qty: number; cost: number; date: string; txId: string }>>();

    for (const tx of todayTxs) {
        const key = tx.contractKey || normalizeSymbolForClient(tx.symbol);
        if (!intradayQueues.has(key)) intradayQueues.set(key, []);
        const queue = intradayQueues.get(key)!;

        let remainingQty = tx.qty;

        while (remainingQty !== 0) {
            if (queue.length === 0) {
                queue.push({ qty: remainingQty, cost: tx.price, date: todayNy, txId: tx.id });
                remainingQty = 0;
            } else {
                const head = queue[0];
                const headSign = Math.sign(head.qty);
                const txSign = Math.sign(remainingQty);

                if (headSign === txSign) {
                    queue.push({ qty: remainingQty, cost: tx.price, date: todayNy, txId: tx.id });
                    remainingQty = 0;
                } else {
                    // Match
                    const matchQty = Math.min(Math.abs(remainingQty), Math.abs(head.qty));

                    // M5.1 PnL
                    let pnl = 0;
                    if (headSign > 0) { // Closing Long
                        pnl = (tx.price - head.cost) * matchQty * tx.multiplier;
                        console.log(`[M5.1] 📊 平多仓: (卖价 ${tx.price} - 买价 ${head.cost}) × ${matchQty} × ${tx.multiplier} = ${pnl.toFixed(2)}`);
                    } else { // Closing Short
                        pnl = (head.cost - tx.price) * matchQty * tx.multiplier;
                        console.log(`[M5.1] 📊 平空仓: (卖价 ${head.cost} - 买价 ${tx.price}) × ${matchQty} × ${tx.multiplier} = ${pnl.toFixed(2)}`);
                    }
                    m5_1 += pnl;

                    console.log(`[M5.1] ✅ Match: ${key} Qty:${matchQty} PnL:${pnl.toFixed(2)} | 累计M5.1=${m5_1.toFixed(2)} (TxIds: ${tx.id.substring(0, 8)} & ${head.txId.substring(0, 8)})`);

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

    console.log(`[M5.1] Result: ${m5_1}`);
    return { m5_1 };
}
