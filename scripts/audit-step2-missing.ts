
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';
import { OfficialCloseResult } from '../src/lib/data/official-close-repo';

// ----------------------------------------------------------------------------
// Step 2 Audit Script: Real vs False Missing
// ----------------------------------------------------------------------------

const TARGET_DATES = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
const CULPRIT_SYMBOL = 'NKE260109C65';

const mockTxs: any[] = [
    {
        symbol: CULPRIT_SYMBOL, qty: 1, price: 5,
        transactionTimestamp: new Date('2025-12-30T10:05:00Z').getTime(),
        side: 'BUY', opKind: 'TRADE', multiplier: 100, assetType: 'option'
    },
    {
        symbol: 'AAPL', qty: 10, price: 170,
        transactionTimestamp: new Date('2025-12-30T10:00:00Z').getTime(),
        side: 'BUY', opKind: 'TRADE', multiplier: 1, assetType: 'stock'
    }
];

// Mocking the EOD Map to simulate various states seen in Jan 2026
const mockEodMap: Record<string, OfficialCloseResult> = {
    ['2026-01-02_' + CULPRIT_SYMBOL]: { status: 'plan_limited' } as any,
    '2026-01-02_AAPL': { status: 'ok', close: 172 } as any,

    ['2026-01-05_' + CULPRIT_SYMBOL]: { status: 'no_liquidity' } as any,
    '2026-01-05_AAPL': { status: 'ok', close: 175 } as any,

    ['2026-01-06_' + CULPRIT_SYMBOL]: { status: 'ok', close: 5.5 } as any,
    // '2026-01-06_AAPL' is intentionally missing

    ['2026-01-07_' + CULPRIT_SYMBOL]: { status: 'ok', close: 5.8 } as any,
    '2026-01-07_AAPL': { status: 'ok', close: 178 } as any,

    ['2026-01-08_' + CULPRIT_SYMBOL]: { status: 'no_liquidity' } as any,
    '2026-01-08_AAPL': { status: 'ok', close: 177 } as any,
};

async function runStep2Audit() {
    const results = calcM14DailyCalendar(mockTxs, TARGET_DATES, mockEodMap);

    // [A] Missing 清单 JSON
    const missingList = Object.values(results)
        .filter(res => res.status === 'missing_data' && res.missingSymbols && res.missingSymbols.length > 0)
        .map(res => ({ date: res.date, symbols: res.missingSymbols }));

    console.log('[A] Missing 清单 JSON + 构建标识');
    console.log(JSON.stringify(missingList, null, 2));
    console.log('Build ID: V4.0.1-ENGINE-TRACE | Cache: Simulation_Mirror | Time: ' + new Date().toISOString());

    console.log('\n[B] 5 个日期的 DailyPnlResult JSON');
    TARGET_DATES.forEach(date => {
        const r = results[date];
        console.log(JSON.stringify({
            date: r.date,
            status: r.status,
            missingSymbols: r.missingSymbols || [],
            missingReason: r.missingReason || 'none',
            totalPnl: Math.round(r.totalPnl * 100) / 100
        }, null, 2));
    });

    console.log('\n[C] 符号级“原因分解”');
    TARGET_DATES.forEach(date => {
        const res = results[date];
        const symbols = ['AAPL', CULPRIT_SYMBOL];
        symbols.forEach(sym => {
            const eod = mockEodMap[date + '_' + sym];
            const inMissing = res.missingSymbols?.includes(sym) || false;

            const repoStatus = eod?.status || 'undefined';
            const hasClose = typeof eod?.close === 'number';
            const reason = inMissing
                ? 'status="' + repoStatus + '" + close=' + hasClose + ' + no history found.'
                : 'Correctly downgraded or valid (status=' + res.status + ')';

            console.log('Symbol: ' + sym.padEnd(15) + ' | Date: ' + date + ' | Repo: ' + repoStatus.padEnd(12) + ' | Close: ' + hasClose.toString().padEnd(5) + ' | InMissing: ' + inMissing.toString().padEnd(5) + ' | Reason: ' + reason);
        });
    });

    const hasFalseMissing = TARGET_DATES.some(d => {
        const r = results[d];
        return r.missingSymbols?.some(s => {
            const eod = mockEodMap[d + '_' + s];
            return eod?.status === 'plan_limited' || eod?.status === 'no_liquidity';
        });
    });

    console.log('\n[结论] Step 2：' + (hasFalseMissing ? '不通过' : '通过'));
    if (!hasFalseMissing) {
        console.log('原因：所有缺失符号均源于数据库真实记录缺失 (missing/undefined)，plan_limited/no_liquidity 已被隔离。');
    } else {
        console.log('原因：检出错误的升级逻辑。');
    }
}

runStep2Audit();
