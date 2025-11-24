'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useRequireAuth } from '@/components/auth/guards';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import { getEffectiveTradingDay, toNyCalendarDayString, prevNyTradingDayString, toNyHm } from '@/lib/ny-time';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { getOfficialCloses } from '@/lib/data/official-close-repo';

interface M6Detail {
    symbol: string;
    prevClose: number;
    currentPrice: number;
    overnightQty: number;
    todayNetChange: number;
    currentNetQty: number;
    multiplier: number;
    overnightPnl: number;
    tradingAdjustment: number;
    totalDayPnl: number;
    todayTrades: Array<{
        time: string;
        qty: number;
        price: number;
        effect: number;
    }>;
}

export function DebugM6Breakdown() {
    const { user } = useRequireAuth();
    const { data: transactions, loading } = useUserTransactions(user?.uid);
    const [m6Details, setM6Details] = React.useState<M6Detail[]>([]);
    const [dataLoading, setDataLoading] = React.useState(true);

    // Custom currency formatter without plus sign
    const formatCurrencyNoPlus = (value: number) => {
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    };

    React.useEffect(() => {
        if (!transactions || transactions.length === 0) {
            setDataLoading(false);
            return;
        }

        const calculateM6Details = async () => {
            setDataLoading(true);
            const todayNy = getEffectiveTradingDay();
            const refDay = prevNyTradingDayString(todayNy);

            // Build holdings snapshot for yesterday (to get overnight positions)
            const yesterdayTxs = transactions.filter(tx => {
                const txDay = toNyCalendarDayString(tx.transactionTimestamp);
                return txDay < todayNy;
            });
            const yesterdaySnapshot = buildHoldingsSnapshot(yesterdayTxs);

            // Build current snapshot
            const currentSnapshot = buildHoldingsSnapshot(transactions);

            // Get today's trades
            const todayTrades = transactions.filter(tx => {
                const txDay = toNyCalendarDayString(tx.transactionTimestamp);
                return txDay === todayNy;
            }).sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

            // Group today's trades by symbol
            const tradesBySymbol = new Map<string, typeof todayTrades>();
            todayTrades.forEach(tx => {
                const sym = tx.symbol;
                if (!tradesBySymbol.has(sym)) {
                    tradesBySymbol.set(sym, []);
                }
                tradesBySymbol.get(sym)!.push(tx);
            });

            // Get all unique symbols
            const allSymbols = new Set<string>();
            yesterdaySnapshot.holdings.forEach(h => allSymbols.add(h.symbol));
            currentSnapshot.holdings.forEach(h => allSymbols.add(h.symbol));

            // Fetch prices
            const symbolList = Array.from(allSymbols);
            const [refCloses, todayCloses] = await Promise.all([
                getOfficialCloses(refDay, symbolList, { shouldAutoRequestBackfill: true }),
                getOfficialCloses(todayNy, symbolList, { shouldAutoRequestBackfill: true }),
            ]);

            const details: M6Detail[] = [];

            for (const symbol of allSymbols) {
                const yesterdayHolding = yesterdaySnapshot.holdings.find(h => h.symbol === symbol);
                const currentHolding = currentSnapshot.holdings.find(h => h.symbol === symbol);

                const overnightQty = yesterdayHolding?.netQty ?? 0;
                const currentNetQty = currentHolding?.netQty ?? 0;
                const multiplier = currentHolding?.multiplier ?? yesterdayHolding?.multiplier ?? 1;

                const prevCloseVal = refCloses[symbol]?.status === 'ok' ? refCloses[symbol].close : null;
                const currentPriceVal = todayCloses[symbol]?.status === 'ok' ? todayCloses[symbol].close : null;

                if (prevCloseVal == null || currentPriceVal == null) continue;

                const prevClose = prevCloseVal;
                const currentPrice = currentPriceVal;

                // Calculate M6 components
                // Formula: M6 = NetQty * (CurrentPrice - PrevClose) - Sum((TradePrice - PrevClose) * TradeQty)

                const symbolTrades = tradesBySymbol.get(symbol) ?? [];
                const tradingAdjustment = symbolTrades.reduce((sum, tx) => {
                    return sum + (tx.price - prevClose) * tx.qty;
                }, 0);

                const overnightPnl = currentNetQty * (currentPrice - prevClose) * multiplier;
                const totalDayPnl = overnightPnl - tradingAdjustment * multiplier;

                const todayNetChange = currentNetQty - overnightQty;

                details.push({
                    symbol,
                    prevClose,
                    currentPrice,
                    overnightQty,
                    todayNetChange,
                    currentNetQty,
                    multiplier,
                    overnightPnl: Math.round(overnightPnl * 100) / 100,
                    tradingAdjustment: Math.round(tradingAdjustment * multiplier * 100) / 100,
                    totalDayPnl: Math.round(totalDayPnl * 100) / 100,
                    todayTrades: symbolTrades.map(tx => ({
                        time: toNyHm(tx.transactionTimestamp),
                        qty: tx.qty,
                        price: tx.price,
                        effect: Math.round((tx.price - prevClose) * tx.qty * multiplier * 100) / 100,
                    })),
                });
            }

            // Sort by absolute PnL descending
            details.sort((a, b) => Math.abs(b.totalDayPnl) - Math.abs(a.totalDayPnl));

            setM6Details(details);
            setDataLoading(false);
        };

        calculateM6Details();
    }, [transactions]);

    const totalM6 = m6Details.reduce((sum, d) => sum + d.totalDayPnl, 0);

    if (loading || dataLoading) return <div>Loading M6 details...</div>;
    if (!transactions || transactions.length === 0) return <div>No transactions found.</div>;

    return (
        <Card className="w-full mt-4">
            <CardHeader>
                <CardTitle>M6 当日盈亏(计算明细)</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg">
                        <div className="text-sm text-muted-foreground">总当日盈亏 (M6)</div>
                        <div className={`text-2xl font-bold ${totalM6 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(totalM6)}
                        </div>
                    </div>

                    <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-sm text-center">
                            <thead className="bg-muted text-muted-foreground">
                                <tr>
                                    <th className="p-2 text-left">标的</th>
                                    <th className="p-2">前收盘</th>
                                    <th className="p-2">当前价</th>
                                    <th className="p-2">隔夜仓</th>
                                    <th className="p-2">日内变化</th>
                                    <th className="p-2">当前仓</th>
                                    <th className="p-2">隔夜盈亏</th>
                                    <th className="p-2">交易调整</th>
                                    <th className="p-2 text-right">总盈亏</th>
                                </tr>
                            </thead>
                            <tbody>
                                {m6Details.map((detail, i) => (
                                    <React.Fragment key={i}>
                                        <tr className="border-t hover:bg-muted/50">
                                            <td className="p-2 font-mono text-left">{detail.symbol}</td>
                                            <td className="p-2">{formatCurrencyNoPlus(detail.prevClose)}</td>
                                            <td className="p-2">{formatCurrencyNoPlus(detail.currentPrice)}</td>
                                            <td className="p-2">{formatNumber(detail.overnightQty)}</td>
                                            <td className={`p-2 ${detail.todayNetChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {detail.todayNetChange >= 0 ? '+' : ''}{formatNumber(detail.todayNetChange)}
                                            </td>
                                            <td className="p-2">{formatNumber(detail.currentNetQty)}</td>
                                            <td className={`p-2 ${detail.overnightPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrencyNoPlus(detail.overnightPnl)}
                                            </td>
                                            <td className={`p-2 ${detail.tradingAdjustment >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrencyNoPlus(detail.tradingAdjustment)}
                                            </td>
                                            <td className={`p-2 text-right font-medium ${detail.totalDayPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrencyNoPlus(detail.totalDayPnl)}
                                            </td>
                                        </tr>
                                        {detail.todayTrades.length > 0 && (
                                            <tr className="bg-slate-50">
                                                <td colSpan={9} className="p-2">
                                                    <details className="text-xs">
                                                        <summary className="cursor-pointer text-muted-foreground">
                                                            今日 {detail.todayTrades.length} 笔交易明细
                                                        </summary>
                                                        <div className="mt-2 pl-4">
                                                            <table className="w-full">
                                                                <thead>
                                                                    <tr className="text-muted-foreground">
                                                                        <th className="p-1">时间</th>
                                                                        <th className="p-1">数量</th>
                                                                        <th className="p-1">价格</th>
                                                                        <th className="p-1">效果</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {detail.todayTrades.map((trade, j) => (
                                                                        <tr key={j}>
                                                                            <td className="p-1">{trade.time}</td>
                                                                            <td className="p-1">{formatNumber(trade.qty)}</td>
                                                                            <td className="p-1">{formatCurrencyNoPlus(trade.price)}</td>
                                                                            <td className={`p-1 ${trade.effect >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                                {formatCurrencyNoPlus(trade.effect)}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </details>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {m6Details.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="p-4 text-center text-muted-foreground">
                                            暂无当日盈亏记录
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
