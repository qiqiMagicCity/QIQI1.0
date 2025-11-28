import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHoldings } from "@/hooks/use-holdings";
import { useUserTransactions, OpKind } from "@/hooks/use-user-transactions";
import { useUser } from "@/firebase";
import { calculateTransactionStats, TransactionStats } from "@/lib/analytics/transaction-analytics";
import { calculateWinRateStats } from "@/lib/analytics/win-rate-analytics";
import { calcGlobalFifo } from "@/lib/pnl/calc-m4-m5-2-global-fifo";
import { toNyCalendarDayString } from "@/lib/ny-time";

export function TransactionAnalysisLiveSelfCheck() {
    const { user } = useUser();
    const { data: transactions } = useUserTransactions(user?.uid);
    const { dailyPnlList, summary } = useHoldings();
    const [report, setReport] = useState<string | null>(null);

    const runCheck = () => {
        if (!transactions || transactions.length === 0) {
            setReport("Error: No transactions found.");
            return;
        }

        const symbol = transactions[0].symbol; // Pick first symbol for test
        const todayNy = toNyCalendarDayString(Date.now());

        // 1. Baseline Snapshot (Current Page Logic)
        const baselineStats = calculateTransactionStats(dailyPnlList, transactions);
        const baselineWinRate = summary?.winRateStats;

        // 2. Recalculate Baseline (Consistency Check)
        const { pnlEvents: basePnlEvents, auditTrail: baseAuditTrail, winCount: baseWinCount, lossCount: baseLossCount } = calcGlobalFifo({
            transactions: transactions,
            todayNy
        });

        const baseDailyPnlMap = new Map<string, number>();
        baseAuditTrail.forEach(e => {
            const date = e.closeDate;
            baseDailyPnlMap.set(date, (baseDailyPnlMap.get(date) || 0) + e.pnl);
        });
        const baseLocalDailyPnlList = Array.from(baseDailyPnlMap.entries()).map(([date, pnl]) => ({ date, pnl }));

        const recalculatedStats = calculateTransactionStats(baseLocalDailyPnlList, transactions);
        const recalculatedWinRate = calculateWinRateStats(baseWinCount, baseLossCount, basePnlEvents);

        // 3. Inject Test Transactions (Win + Loss to ensure all stats change)
        const now = Date.now();
        // Trade 1: WIN (+10,000)
        const testBuyTx1 = {
            ...transactions[0],
            transactionId: "TEST_TX_BUY_1_" + now,
            symbol: "TEST_SYM",
            contractKey: undefined,
            opKind: "BUY" as OpKind,
            qty: 100,
            price: 100,
            transactionTimestamp: now - 2000,
            multiplier: 1,
            commission: 0
        };
        const testSellTx1 = {
            ...transactions[0],
            transactionId: "TEST_TX_SELL_1_" + now,
            symbol: "TEST_SYM",
            contractKey: undefined,
            opKind: "SELL" as OpKind,
            qty: -100, // Negative for SELL
            price: 200,
            transactionTimestamp: now - 1000,
            multiplier: 1,
            commission: 0
        };

        // Trade 2: LOSS (-5,000)
        const testBuyTx2 = {
            ...transactions[0],
            transactionId: "TEST_TX_BUY_2_" + now,
            symbol: "TEST_SYM",
            contractKey: undefined,
            opKind: "BUY" as OpKind,
            qty: 100,
            price: 100,
            transactionTimestamp: now - 500,
            multiplier: 1,
            commission: 0
        };
        const testSellTx2 = {
            ...transactions[0],
            transactionId: "TEST_TX_SELL_2_" + now,
            symbol: "TEST_SYM",
            contractKey: undefined,
            opKind: "SELL" as OpKind,
            qty: -100, // Negative for SELL
            price: 50,
            transactionTimestamp: now,
            multiplier: 1,
            commission: 0
        };

        const injectedTransactions = [testBuyTx1, testSellTx1, testBuyTx2, testSellTx2, ...transactions];

        // 4. Recalculate with Injection (Reactivity Check)
        const { pnlEvents: newPnlEvents, auditTrail: newAuditTrail, winCount: newWinCount, lossCount: newLossCount } = calcGlobalFifo({
            transactions: injectedTransactions,
            todayNy
        });

        const newDailyPnlMap = new Map<string, number>();
        newAuditTrail.forEach(e => {
            const date = e.closeDate;
            newDailyPnlMap.set(date, (newDailyPnlMap.get(date) || 0) + e.pnl);
        });
        const newLocalDailyPnlList = Array.from(newDailyPnlMap.entries()).map(([date, pnl]) => ({ date, pnl }));

        const newStats = calculateTransactionStats(newLocalDailyPnlList, injectedTransactions);
        const newWinRate = calculateWinRateStats(newWinCount, newLossCount, newPnlEvents);

        // 5. Generate Report
        let log = `=== Transaction Analysis Live Self-Check ===\n`;
        log += `Symbol: TEST_SYM (Test Injection Target)\n\n`;

        // Consistency Check
        log += `[Consistency Check (Page vs Recalc)]\n`;

        const checkMatch = (name: string, val1: any, val2: any) => {
            const match = JSON.stringify(val1) === JSON.stringify(val2);
            return `- ${name}: ${match ? "完全一致 ✔" : `❌ Mismatch (Page: ${JSON.stringify(val1)}, Recalc: ${JSON.stringify(val2)})`}`;
        };

        log += `${checkMatch("Win Rate Stats", baselineWinRate, recalculatedWinRate)}\n`;

        const getLatestPnl = (s: TransactionStats) => {
            const list = s.pnl?.weekly || [];
            return list.length > 0 ? list[list.length - 1].value : null;
        };
        const getLatestValue = (s: TransactionStats) => {
            const list = s.value?.weekly || [];
            return list.length > 0 ? list[list.length - 1].value : null;
        };
        const getLatestEff = (s: TransactionStats) => {
            const list = s.efficiency?.weekly || [];
            return list.length > 0 ? list[list.length - 1].value : null;
        };
        const getScatterSum = (s: TransactionStats) => s.scatter.reduce((acc, curr) => acc + curr.y, 0);

        log += `${checkMatch("Avg PnL (Latest Weekly)", getLatestPnl(baselineStats), getLatestPnl(recalculatedStats))}\n`;


        // Reactivity Check
        log += `\n[Reactivity Check (Baseline vs Injected)]\n`;

        const checkDiff = (name: string, val1: any, val2: any) => {
            const changed = JSON.stringify(val1) !== JSON.stringify(val2);
            return `- ${name}: ${changed ? "已随测试交易变动 → OK" : "⚠ 潜在缓存/依赖问题 (No Change)"}`;
        };

        log += `${checkDiff("Avg. PnL / Day", getLatestPnl(baselineStats), getLatestPnl(newStats))}\n`;
        log += `${checkDiff("Avg. Trading Value", getLatestValue(baselineStats), getLatestValue(newStats))}\n`;
        log += `${checkDiff("PnL per 10k", getLatestEff(baselineStats), getLatestEff(newStats))}\n`;
        log += `${checkDiff("Profit / Loss Ratio (Whole Object)", baselineWinRate, newWinRate)}\n`;
        log += `  - Baseline: Win=${baselineWinRate?.winCount}, Loss=${baselineWinRate?.lossCount}, Ratio=${baselineWinRate?.pnlRatio?.toFixed(2)}\n`;
        log += `  - Recalc:   Win=${newWinRate?.winCount}, Loss=${newWinRate?.lossCount}, Ratio=${newWinRate?.pnlRatio?.toFixed(2)}\n`;
        log += `  - PnL Events: Base=${basePnlEvents.length}, New=${newPnlEvents.length}\n`;
        log += `  - Injected Txs: ${injectedTransactions.length} (Base: ${transactions.length})\n`;
        log += `  - Test Tx 1: Symbol=${testBuyTx1.symbol}, Op=${testBuyTx1.opKind}, Qty=${testBuyTx1.qty}, Key=${testBuyTx1.contractKey}\n`;

        log += `${checkDiff("Scatter Data (PnL Sum)", getScatterSum(baselineStats), getScatterSum(newStats))}\n`;

        setReport(log);
        console.log(log);
    };

    return (
        <Card className="mt-8 border-dashed border-yellow-500 bg-yellow-500/5">
            <CardHeader>
                <CardTitle className="text-yellow-600 text-sm font-mono">Dev Tool: Transaction Analysis Self-Check</CardTitle>
            </CardHeader>
            <CardContent>
                <Button onClick={runCheck} variant="outline" className="mb-4">
                    Run Live Self-Check
                </Button>
                {report && (
                    <pre className="text-xs font-mono bg-black/80 text-green-400 p-4 rounded overflow-auto whitespace-pre-wrap">
                        {report}
                    </pre>
                )}
            </CardContent>
        </Card>
    );
}
