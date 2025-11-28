import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHoldings } from "@/hooks/use-holdings";
import { useUserTransactions } from "@/hooks/use-user-transactions";
import { useUser } from "@/firebase";
import { getISOWeek } from "date-fns";

export function MetricVerificationReport() {
    const { dailyPnlList } = useHoldings();
    const { user } = useUser();
    const { data: transactions } = useUserTransactions(user?.uid);

    const report = useMemo(() => {
        if (!dailyPnlList || !transactions) return null;

        // 1. Prepare Raw Data (Same as StockDetails)
        const dailyDataMap = new Map<string, { pnl: number; tradingValue: number }>();

        dailyPnlList.forEach(item => {
            const current = dailyDataMap.get(item.date) || { pnl: 0, tradingValue: 0 };
            dailyDataMap.set(item.date, { ...current, pnl: item.pnl });
        });

        transactions.forEach(tx => {
            if (!['BUY', 'SELL', 'SHORT', 'COVER'].includes(tx.opKind)) return;
            const date = new Date(tx.transactionTimestamp).toISOString().substring(0, 10);
            const val = Math.abs(tx.price * tx.qty * (tx.multiplier || 1));
            const current = dailyDataMap.get(date) || { pnl: 0, tradingValue: 0 };
            dailyDataMap.set(date, { ...current, tradingValue: current.tradingValue + val });
        });

        const dailyItems = Array.from(dailyDataMap.entries()).map(([date, d]) => ({ date, ...d }));

        // 2. Manual Calculation Logic (Strictly following user formulas)
        // Filter for last 4 weeks (approx 28 days)
        const sortedDates = dailyItems.map(d => d.date).sort();
        const lastDate = sortedDates[sortedDates.length - 1];
        if (!lastDate) return null;

        const cutoffDate = new Date(lastDate);
        cutoffDate.setDate(cutoffDate.getDate() - 28);
        const cutoffStr = cutoffDate.toISOString().substring(0, 10);

        const recentItems = dailyItems.filter(d => d.date >= cutoffStr);

        // Group by Week for the report
        const weeklyGroups = new Map<string, { items: typeof recentItems }>();
        recentItems.forEach(item => {
            const d = new Date(item.date);
            const week = `${d.getFullYear()}-W${getISOWeek(d).toString().padStart(2, '0')}`;
            const group = weeklyGroups.get(week) || { items: [] };
            group.items.push(item);
            weeklyGroups.set(week, group);
        });

        const results = Array.from(weeklyGroups.entries()).map(([week, { items }]) => {
            // --- Manual Calculation ---
            const totalPnl = items.reduce((sum, item) => sum + item.pnl, 0);
            const totalValue = items.reduce((sum, item) => sum + item.tradingValue, 0);
            const days = items.length; // "Trading Days" = days with data in this set

            const manualAvgPnl = days > 0 ? totalPnl / days : 0;
            const manualAvgValue = days > 0 ? totalValue / days : 0;
            const manualEfficiency = totalValue > 0 ? (totalPnl / totalValue) * 10000 : 0;

            // --- Frontend Logic Simulation (what StockDetails does) ---
            // In StockDetails, it aggregates by summing then dividing by count.
            // It should be mathematically identical if the grouping is the same.
            const feSumPnl = items.reduce((s, i) => s + i.pnl, 0);
            const feSumValue = items.reduce((s, i) => s + i.tradingValue, 0);
            const feCount = items.length;

            const feAvgPnl = feCount > 0 ? feSumPnl / feCount : 0;
            const feAvgValue = feCount > 0 ? feSumValue / feCount : 0;
            const feEfficiency = feSumValue > 0 ? (feSumPnl / feSumValue) * 10000 : 0;

            // Comparison
            const pnlDiffPct = manualAvgPnl !== 0 ? Math.abs((feAvgPnl - manualAvgPnl) / manualAvgPnl) * 100 : 0;
            const valDiffPct = manualAvgValue !== 0 ? Math.abs((feAvgValue - manualAvgValue) / manualAvgValue) * 100 : 0;
            const effDiffPct = manualEfficiency !== 0 ? Math.abs((feEfficiency - manualEfficiency) / manualEfficiency) * 100 : 0;

            return {
                week,
                manual: { avgPnl: manualAvgPnl, avgValue: manualAvgValue, efficiency: manualEfficiency },
                frontend: { avgPnl: feAvgPnl, avgValue: feAvgValue, efficiency: feEfficiency },
                diff: { pnl: pnlDiffPct, value: valDiffPct, efficiency: effDiffPct },
                match: pnlDiffPct < 0.01 && valDiffPct < 0.01 && effDiffPct < 0.01
            };
        }).sort((a, b) => b.week.localeCompare(a.week));

        return results;
    }, [dailyPnlList, transactions]);

    if (!report) return null;

    return (
        <Card className="mt-8 border-2 border-dashed border-yellow-500/50 bg-yellow-500/5">
            <CardHeader>
                <CardTitle className="text-yellow-500 font-mono">🔍 Metric Verification Report (Self-Check)</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-6 font-mono text-xs md:text-sm">
                    {report.map(row => (
                        <div key={row.week} className="border-b border-border/50 pb-4 last:border-0">
                            <div className="font-bold mb-2 text-foreground">[{row.week}]</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Avg PnL */}
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Avg PnL/Day:</span>
                                    <div className="flex gap-2">
                                        <span className="text-emerald-500">FE: ${row.frontend.avgPnl.toFixed(2)}</span>
                                        <span className="text-sky-500">Manual: ${row.manual.avgPnl.toFixed(2)}</span>
                                        <span>{row.diff.pnl < 0.01 ? '✅' : `⚠️ ${row.diff.pnl.toFixed(2)}%`}</span>
                                    </div>
                                </div>

                                {/* Avg Value */}
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Avg Value/Day:</span>
                                    <div className="flex gap-2">
                                        <span className="text-emerald-500">FE: ${row.frontend.avgValue.toFixed(0)}</span>
                                        <span className="text-sky-500">Manual: ${row.manual.avgValue.toFixed(0)}</span>
                                        <span>{row.diff.value < 0.01 ? '✅' : `⚠️ ${row.diff.value.toFixed(2)}%`}</span>
                                    </div>
                                </div>

                                {/* Efficiency */}
                                <div className="flex justify-between items-center col-span-1 md:col-span-2">
                                    <span className="text-muted-foreground">PnL per 10k:</span>
                                    <div className="flex gap-2">
                                        <span className="text-emerald-500">FE: {row.frontend.efficiency.toFixed(2)}</span>
                                        <span className="text-sky-500">Manual: {row.manual.efficiency.toFixed(2)}</span>
                                        <span>{row.diff.efficiency < 0.01 ? '✅' : `⚠️ ${row.diff.efficiency.toFixed(2)}%`}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    <div className="mt-4 pt-4 border-t border-border">
                        <h4 className="font-bold mb-2">[Overall Assessment]</h4>
                        <p>Match Rate: {report.filter(r => r.match).length} / {report.length} Weeks ({((report.filter(r => r.match).length / report.length) * 100).toFixed(1)}%)</p>
                        <p className="text-muted-foreground">
                            {report.every(r => r.match)
                                ? "Algorithm logic has no structural deviation √"
                                : "Discrepancies detected. Please review specific weeks above."}
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
