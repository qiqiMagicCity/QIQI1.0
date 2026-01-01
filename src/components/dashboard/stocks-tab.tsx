'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useUser } from '@/firebase';
import { SymbolSidebar } from '@/components/symbol/symbol-sidebar';
import { SymbolHeader } from '@/components/symbol/symbol-header';
import { SymbolDashboard } from '@/components/symbol/symbol-dashboard';
import { SymbolTransactionsTable, SymbolTransactionRow } from '@/components/symbol/symbol-transactions-table';
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo';
import { nowNyCalendarDayString, toNyCalendarDayString, nyWeekdayIndex } from '@/lib/ny-time';

export function StocksTab() {
    const { user } = useUser();
    const { data: transactions, loading } = useUserTransactions(user?.uid);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('');

    // --- Sidebar Logic (from SymbolLayout) ---
    const sidebarItems = useMemo(() => {
        if (!transactions || transactions.length === 0) return [];

        const groups = new Map<string, typeof transactions>();

        transactions.forEach(t => {
            const root = t.symbol.split(' ')[0];
            let key = root;
            if (t.assetType === 'option') {
                key = `${root} Options`;
            }
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(t);
        });

        const items = Array.from(groups.entries()).map(([displayName, txs]) => {
            const fifoResult = calcGlobalFifo({
                transactions: txs,
                todayNy: nowNyCalendarDayString(),
            });
            const pnl = fifoResult.totalRealizedPnl;
            return {
                symbol: displayName,
                count: txs.length,
                hasLoss: pnl < -0.01,
                hasProfit: pnl > 0.01,
            };
        });

        return items.sort((a, b) => b.count - a.count);
    }, [transactions]);

    // Auto-select first symbol if none selected
    useEffect(() => {
        if (!selectedSymbol && sidebarItems.length > 0) {
            setSelectedSymbol(sidebarItems[0].symbol);
        }
    }, [sidebarItems, selectedSymbol]);


    // --- Details Logic (from SymbolPage) ---
    // Filter transactions for the selected symbol
    const symbolTransactions = useMemo(() => {
        if (!transactions || !selectedSymbol) return [];

        const isOptionPage = selectedSymbol.endsWith(' OPTIONS');
        const realSymbol = isOptionPage ? selectedSymbol.replace(' OPTIONS', '') : selectedSymbol;

        return transactions.filter(t => {
            const root = t.symbol.split(' ')[0];
            if (root !== realSymbol) return false;

            if (isOptionPage) {
                return t.assetType === 'option';
            } else {
                return t.assetType !== 'option';
            }
        });
    }, [transactions, selectedSymbol]);

    // Metrics & FIFO
    const { fifoResult, metrics, tableData } = useMemo(() => {
        if (symbolTransactions.length === 0) {
            return { fifoResult: null, metrics: null, tableData: [] };
        }

        const fifo = calcGlobalFifo({
            transactions: symbolTransactions,
            todayNy: nowNyCalendarDayString(),
        });

        let longCount = 0;
        let shortCount = 0;
        symbolTransactions.forEach(t => {
            if (t.side === 'BUY') longCount++;
            if (t.side === 'SELL') shortCount++;
        });

        let totalCost = 0;
        let totalQty = 0;
        if (fifo.openPositions) {
            fifo.openPositions.forEach((queue) => {
                queue.forEach(pos => {
                    totalCost += pos.qty * pos.cost;
                    totalQty += pos.qty;
                });
            });
        }

        const realizedPnl = fifo.totalRealizedPnl ?? 0;
        const breakEvenPrice = totalQty !== 0 ? Math.abs((totalCost - realizedPnl) / totalQty) : 0;
        const avgCost = totalQty !== 0 ? Math.abs(totalCost / totalQty) : 0;

        const calculatedMetrics = {
            longCount,
            shortCount,
            totalTrades: symbolTransactions.length,
            winCount: fifo.winCount,
            lossCount: fifo.lossCount,
            realizedPnl,
            breakEvenPrice,
            avgCost,
        };

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const sortedTxs = [...symbolTransactions].sort((a, b) => b.transactionTimestamp - a.transactionTimestamp);
        const data: SymbolTransactionRow[] = sortedTxs.map(t => {
            const dateStr = toNyCalendarDayString(t.transactionTimestamp);
            return {
                id: t.id,
                date: dateStr,
                weekday: weekdays[nyWeekdayIndex(t.transactionTimestamp)],
                direction: t.side === 'BUY' ? 'Buy' : 'Sell',
                unitPrice: t.price,
                orderAmount: Math.abs(t.price * t.qty),
            };
        });

        return { fifoResult: fifo, metrics: calculatedMetrics, tableData: data };
    }, [symbolTransactions]);

    if (loading) {
        return <div className="p-8 text-center text-slate-500">正在加载交易记录...</div>;
    }

    if (transactions?.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[300px] gap-4">
                <p className="text-muted-foreground">暂无交易记录，无法展示个股详情</p>
            </div>
        );
    }

    return (
        <div className="flex flex-row gap-6 h-[800px] overflow-hidden">
            {/* Left Sidebar */}
            <div className="w-[380px] shrink-0 h-full">
                {/* 
                 Adjusted width to 380px to fit better in tab. 
                 Passed onSelect to enable embedded mode. 
               */}
                <SymbolSidebar
                    items={sidebarItems}
                    currentSymbol={selectedSymbol}
                    onSelect={setSelectedSymbol}
                />
            </div>

            {/* Right Content */}
            <div className="flex-1 h-full bg-slate-900/30 backdrop-blur-sm rounded-2xl border border-slate-800 overflow-hidden flex flex-col">
                {selectedSymbol && metrics ? (
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Header */}
                        <SymbolHeader symbol={selectedSymbol} />

                        {/* Dashboard */}
                        <SymbolDashboard
                            longCount={metrics.longCount}
                            shortCount={metrics.shortCount}
                            totalTrades={metrics.totalTrades}
                            winCount={metrics.winCount}
                            lossCount={metrics.lossCount}
                            realizedPnl={metrics.realizedPnl}
                            breakEvenPrice={metrics.breakEvenPrice}
                            avgCost={metrics.avgCost}
                        />

                        {/* Transactions Table */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-emerald-500 border-l-4 border-emerald-500 pl-2">
                                交易明细
                            </h3>
                            <SymbolTransactionsTable data={tableData} />
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        请选择一个标的查看详情
                    </div>
                )}
            </div>
        </div>
    );
}
