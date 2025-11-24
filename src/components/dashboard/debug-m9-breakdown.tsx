'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useRequireAuth } from '@/components/auth/guards';
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo';
import { getEffectiveTradingDay } from '@/lib/ny-time';
import { formatCurrency, formatNumber } from '@/lib/utils';

export function DebugM9Breakdown() {
    const { user } = useRequireAuth();
    const { data: transactions, loading } = useUserTransactions(user?.uid);
    const todayNy = getEffectiveTradingDay();

    console.log('DebugM9Breakdown: transactions count:', transactions?.length);

    // Expose to window for debugging
    if (typeof window !== 'undefined') {
        (window as any).debugTransactions = transactions;
    }

    if (transactions?.length > 0) {
        console.log('DebugM9Breakdown: first 5 transactions:', transactions.slice(0, 5));
        const splitTxs = transactions.filter((tx: any) => tx.opKind === 'SPLIT' || tx.type === 'Stock Split');
        console.log('DebugM9Breakdown: SPLIT transactions:', splitTxs);
    }

    const result = React.useMemo(() => {
        if (!transactions || transactions.length === 0) return { totalRealizedPnl: 0, winCount: 0, lossCount: 0, auditTrail: [] };
        const calcResult = calcGlobalFifo({ transactions: transactions || [], todayNy });
        // Sort auditTrail by closeDate descending
        const sortedAuditTrail = [...(calcResult.auditTrail || [])].sort((a, b) => {
            return b.closeDate.localeCompare(a.closeDate);
        });
        return { ...calcResult, auditTrail: sortedAuditTrail };
    }, [transactions, todayNy]);

    // Custom currency formatter without plus sign
    const formatCurrencyNoPlus = (value: number) => {
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    };

    // Expose result to window
    if (typeof window !== 'undefined') {
        (window as any).debugM9Result = result;
    }

    if (loading) return <div>Loading transactions...</div>;
    if (!transactions || transactions.length === 0) return <div>No transactions found.</div>;

    return (
        <Card className="w-full mt-4">
            <CardHeader>
                <CardTitle>M9 (累计已实现盈亏) 计算明细</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-muted rounded-lg">
                            <div className="text-sm text-muted-foreground">总已实现盈亏 (M9)</div>
                            <div className={`text-2xl font-bold ${result.totalRealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(result.totalRealizedPnl)}
                            </div>
                        </div>
                        <div className="p-4 bg-muted rounded-lg">
                            <div className="text-sm text-muted-foreground">胜率统计</div>
                            <div className="text-lg">
                                {result.winCount} 胜 / {result.lossCount} 负
                                <span className="ml-2 text-sm text-muted-foreground">
                                    ({((result.winCount + result.lossCount) > 0 ? result.winCount / (result.winCount + result.lossCount) * 100 : 0).toFixed(1)}%)
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-sm text-center">
                            <thead className="bg-muted text-muted-foreground">
                                <tr>
                                    <th className="p-2 text-left">标的</th>
                                    <th className="p-2">开仓日期</th>
                                    <th className="p-2">开仓价</th>
                                    <th className="p-2">平仓日期</th>
                                    <th className="p-2">平仓价</th>
                                    <th className="p-2">数量</th>
                                    <th className="p-2 text-right">盈亏</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.auditTrail?.map((row, i) => (
                                    <tr key={i} className="border-t hover:bg-muted/50">
                                        <td className="p-2 font-mono text-left">{row.symbol}</td>
                                        <td className="p-2">{row.openDate}</td>
                                        <td className="p-2">{formatCurrency(row.openPrice)}</td>
                                        <td className="p-2">{row.closeDate}</td>
                                        <td className="p-2">{formatCurrency(row.closePrice)}</td>
                                        <td className="p-2">{formatNumber(row.qty)}</td>
                                        <td className={`p-2 text-right font-medium ${row.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrencyNoPlus(row.pnl)}
                                        </td>
                                    </tr>
                                ))}
                                {(!result.auditTrail || result.auditTrail.length === 0) && (
                                    <tr>
                                        <td colSpan={7} className="p-4 text-center text-muted-foreground">
                                            暂无已实现盈亏记录
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </CardContent>
        </Card>
    );
}
