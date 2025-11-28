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
    legacyPnl: number; // M6.1
    newPnl: number;    // M6.2
    totalDayPnl: number;
    todayTrades: Array<{
        time: string;
        qty: number;
        price: number;
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
            todayTrades.forEach(tx => allSymbols.add(tx.symbol)); // Ensure symbols with only today's trades are included

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

                // If we don't have both prices, we can't calculate PnL for this symbol.
                // However, we still want to show the symbol if there are trades or holdings.
                // For now, we'll skip if prices are missing, but a more robust solution might
                // show the symbol with N/A for PnL.
                if (prevCloseVal == null || currentPriceVal == null) continue;

                const prevClose = prevCloseVal;
                const currentPrice = currentPriceVal;

                // --- M6 Attribution Logic (FIFO) ---
                let m6_1_legacy = 0;
                let m6_2_new = 0;

                // Initial Lot from Overnight
                let lots: Array<{ qty: number; price: number; source: 'legacy' | 'new' }> = [];
                if (overnightQty !== 0) {
                    lots.push({ qty: overnightQty, price: prevClose, source: 'legacy' });
                }

                const symbolTrades = tradesBySymbol.get(symbol) ?? [];

                // Process trades
                for (const tx of symbolTrades) {
                    let qtyToProcess = tx.qty;

                    while (Math.abs(qtyToProcess) > 0.000001) {
                        if (lots.length === 0) {
                            // Open new position
                            lots.push({ qty: qtyToProcess, price: tx.price, source: 'new' });
                            qtyToProcess = 0;
                        } else {
                            const head = lots[0];
                            const headSign = head.qty > 0 ? 1 : -1;
                            const txSign = qtyToProcess > 0 ? 1 : -1;

                            if (headSign === txSign) {
                                // Adding to position (Opening)
                                lots.push({ qty: qtyToProcess, price: tx.price, source: 'new' });
                                qtyToProcess = 0;
                            } else {
                                // Reducing position (Closing)
                                const absHead = Math.abs(head.qty);
                                const absTx = Math.abs(qtyToProcess);

                                let matchQty: number;
                                if (absHead <= absTx) {
                                    matchQty = -head.qty; // Exhaust head
                                } else {
                                    matchQty = qtyToProcess; // Partial head
                                }

                                // Realized PnL = -1 * matchQty * (TradePrice - LotPrice)
                                const realized = -1 * matchQty * (tx.price - head.price);

                                if (head.source === 'legacy') {
                                    m6_1_legacy += realized;
                                } else {
                                    m6_2_new += realized;
                                }

                                // Update Lot
                                head.qty += matchQty;
                                qtyToProcess -= matchQty;

                                if (Math.abs(head.qty) < 0.00001) {
                                    lots.shift();
                                }
                            }
                        }
                    }
                }

                // Unrealized PnL for remaining lots
                for (const lot of lots) {
                    const unrealized = lot.qty * (currentPrice - lot.price);
                    if (lot.source === 'legacy') {
                        m6_1_legacy += unrealized;
                    } else {
                        m6_2_new += unrealized;
                    }
                }

                const totalDayPnl = m6_1_legacy + m6_2_new;
                const todayNetChange = currentNetQty - overnightQty;

                details.push({
                    symbol,
                    prevClose,
                    currentPrice,
                    overnightQty,
                    todayNetChange,
                    currentNetQty,
                    multiplier,
                    legacyPnl: Math.round(m6_1_legacy * multiplier * 100) / 100,
                    newPnl: Math.round(m6_2_new * multiplier * 100) / 100,
                    totalDayPnl: Math.round(totalDayPnl * multiplier * 100) / 100,
                    todayTrades: symbolTrades.map(tx => ({
                        time: toNyHm(tx.transactionTimestamp),
                        qty: tx.qty,
                        price: tx.price,
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
                <CardTitle>当日总盈亏（Daily PnL）</CardTitle>
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
                                    <th className="p-2">存量盈亏 (Legacy)</th>
                                    <th className="p-2">增量盈亏 (New)</th>
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
                                            <td className={`p-2 ${detail.legacyPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrencyNoPlus(detail.legacyPnl)}
                                            </td>
                                            <td className={`p-2 ${detail.newPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrencyNoPlus(detail.newPnl)}
                                            </td>
                                            <td className={`p-2 text-right font-medium ${detail.totalDayPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrencyNoPlus(detail.totalDayPnl)}
                                            </td>
                                        </tr>
                                        {detail.todayTrades.length > 0 && (
                                            <tr className="bg-slate-50 dark:bg-slate-900">
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
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {detail.todayTrades.map((trade, j) => (
                                                                        <tr key={j}>
                                                                            <td className="p-1">{trade.time}</td>
                                                                            <td className="p-1">{formatNumber(trade.qty)}</td>
                                                                            <td className="p-1">{formatCurrencyNoPlus(trade.price)}</td>
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

                    {/* Debug Info */}
                    <details className="mt-4">
                        <summary className="text-xs text-muted-foreground cursor-pointer">Debug Data (Raw)</summary>
                        <pre id="m6-debug-json" className="mt-2 p-2 bg-slate-950 text-slate-50 text-[10px] overflow-auto max-h-96 rounded">
                            {/* We need to access the raw data here. Since we don't have it in state, we might need to store it or just dump m6Details which has most info */}
                            {JSON.stringify(m6Details, null, 2)}
                        </pre>
                    </details>
                </div>
            </CardContent>
        </Card>
    );
}
