
import { calcM14DailyCalendar } from '../src/lib/pnl/calc-m14-daily-calendar';

const TARGET_DATES = ['2026-01-02', '2026-01-05', '2026-01-06'];

async function runAudit() {
    // 模拟 Jan 2026 的关键期权
    const mockTxs: any[] = [
        {
            symbol: 'NKE260109C65', qty: 1, price: 5,
            transactionTimestamp: new Date('2025-12-30T10:05:00Z').getTime(),
            side: 'BUY', opKind: 'TRADE', multiplier: 100, assetType: 'option'
        }
    ];

    // 模拟真实 API 行为：Jan 02 还是 plan_limited
    const mockEodMap: any = {
        '2026-01-02_NKE260109C65': { status: 'plan_limited' }, // 触发成本降级
        '2026-01-05_NKE260109C65': { status: 'no_liquidity' }, // 触发历史降级
        '2026-01-06_NKE260109C65': { status: 'ok', close: 5.5 }
    };

    const results = calcM14DailyCalendar(mockTxs, TARGET_DATES, mockEodMap);

    console.log('--- 证据 1: 引擎输出结果 ---');
    TARGET_DATES.forEach(date => {
        const res = results[date];
        console.log(`[${date}] status: ${res.status}, missingSymbols: ${JSON.stringify(res.missingSymbols || [])}`);
    });

    console.log('\n--- 证据 2: 符号诊断 ---');
    const sym = 'NKE260109C65';
    TARGET_DATES.forEach(date => {
        const eod = mockEodMap[`${date}_${sym}`];
        console.log(`[${date}] ${sym}: repo_status=${eod?.status}, close=${eod?.close ?? 'undefined'}`);
    });

    console.log('\n--- 证据 3: UI 侧录入判定 ---');
    TARGET_DATES.forEach(date => {
        const res = results[date];
        // 模拟 UI 逻辑: if (res.status === "missing_data" && res.missingSymbols && res.missingSymbols.length > 0)
        const inMissingList = (res.status === 'missing_data' && res.missingSymbols && res.missingSymbols.length > 0);
        console.log(`[${date}] UI sees status="${res.status}". Is in Missing EOD list? ${inMissingList}`);
    });

    const anyMissing = TARGET_DATES.some(d => results[d].status === 'missing_data');
    console.log(`\n结论：${anyMissing ? 'A 真缺失' : 'B 假缺失'}`);
}

runAudit();
