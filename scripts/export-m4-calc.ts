// scripts/export-m4-calc.ts
// 验证 M4 (今日平仓盈利-历史仓位) 计算过程

// @ts-ignore
import Database from 'better-sqlite3';
import { calcGlobalFifo } from '../src/lib/pnl/calc-m4-m5-2-global-fifo';
import { toNyCalendarDayString } from '../src/lib/ny-time';

const DB_PATH = 'c:\\Users\\QiQi_\\Desktop\\trading.db';

// 数据库中的交易记录类型
type DbTransaction = {
    id: string;
    symbol: string;
    qty: number;
    price: number;
    transactionTimestamp: number;
    contractKey?: string;
    multiplier: number;
};

function main() {
    console.log('='.repeat(80));
    console.log('M4 计算验证 - 今日平仓盈利(历史仓位)');
    console.log('='.repeat(80));

    const db = new Database(DB_PATH, { readonly: true });

    // 获取所有交易记录
    const allTxRows = db.prepare(`
        SELECT 
            id,
            symbol,
            qty,
            price,
            transactionTimestamp,
            contractKey,
            multiplier
        FROM transactions
        ORDER BY transactionTimestamp ASC
    `).all() as DbTransaction[];

    console.log(`\n📊 总交易记录数: ${allTxRows.length}`);

    // 转换为算法所需格式
    const transactions = allTxRows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        qty: row.qty,
        price: row.price,
        transactionTimestamp: row.transactionTimestamp,
        contractKey: row.contractKey || '',
        multiplier: row.multiplier
    }));

    // 使用当前日期作为 todayNy
    const todayNy = toNyCalendarDayString(Date.now());
    console.log(`\n📅 纽约交易日 (todayNy): ${todayNy}`);

    // 筛选今日交易
    const todayTxs = transactions.filter(tx =>
        toNyCalendarDayString(tx.transactionTimestamp) === todayNy
    );
    console.log(`\n📈 今日交易记录数: ${todayTxs.length}`);

    if (todayTxs.length > 0) {
        console.log('\n今日交易明细:');
        todayTxs.forEach(tx => {
            const time = new Date(tx.transactionTimestamp).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
            const action = tx.qty > 0 ? 'BUY' : 'SELL';
            console.log(`  ${time} | ${action} ${tx.symbol} | ${Math.abs(tx.qty)} @ $${tx.price}`);
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log('开始执行 M4 计算 (全局 FIFO)');
    console.log('='.repeat(80));

    // 执行计算
    const result = calcGlobalFifo({
        transactions: transactions as any,
        todayNy
    });

    console.log('\n' + '='.repeat(80));
    console.log('计算结果汇总');
    console.log('='.repeat(80));
    console.log(`\n✅ M4 (今日平仓盈利-历史仓位): $${result.m4.toFixed(2)}`);
    console.log(`   M5.2 (今日平仓盈利-今日仓位): $${result.m5_2.toFixed(2)}`);
    console.log(`   合计今日平仓盈利: $${(result.m4 + result.m5_2).toFixed(2)}`);

    console.log('\n' + '='.repeat(80));
    console.log('验证说明');
    console.log('='.repeat(80));
    console.log(`
M4 计算逻辑:
1. 全局 FIFO 规则: 按时间戳排序所有交易，每个品种维护一个全局队列
2. 今日卖出交易会按 FIFO 顺序配对队列中的买入
3. 如果配对到 "历史日期" 的买入 → 计入 M4
4. 如果配对到 "今日" 的买入 → 计入 M5.2

PnL 计算公式:
- 平多仓: (卖出价 - 买入价) × 数量 × 合约乘数
- 平空仓: (做空价 - 平仓价) × 数量 × 合约乘数

以上控制台输出中的 [M4 Debug] 日志展示了每笔配对的详细过程。
    `);

    db.close();
}

main();
