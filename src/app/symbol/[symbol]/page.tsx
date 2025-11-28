'use client';

import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { SymbolHeader } from '@/components/symbol/symbol-header';
import { SymbolDashboard } from '@/components/symbol/symbol-dashboard';
import { SymbolTransactionsTable, SymbolTransactionRow } from '@/components/symbol/symbol-transactions-table';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useUser } from '@/firebase';
import { toNyCalendarDayString, nyWeekdayIndex, nowNyCalendarDayString } from '@/lib/ny-time';
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo';

export default function SymbolPage() {
    const params = useParams();
    const symbol = (params.symbol as string).toUpperCase();
    const { user } = useUser();
    const { data: transactions, loading } = useUserTransactions(user?.uid);

    // Filter transactions for the current symbol AND its asset type (Stock vs Option)
    const symbolTransactions = useMemo(() => {
        if (!transactions) return [];

        const isOptionPage = symbol.endsWith(' OPTIONS');
        const realSymbol = isOptionPage ? symbol.replace(' OPTIONS', '') : symbol;

        return transactions.filter(t => {
            const root = t.symbol.split(' ')[0];
            if (root !== realSymbol) return false;

            if (isOptionPage) {
                return t.assetType === 'option';
            } else {
                return t.assetType !== 'option';
            }
        });
    }, [transactions, symbol]);

    // Run FIFO Calculation for this symbol to get accurate PnL and Audit Trail
    const fifoResult = useMemo(() => {
        if (symbolTransactions.length === 0) return null;

        return calcGlobalFifo({
            transactions: symbolTransactions,
            todayNy: nowNyCalendarDayString(),
        });
    }, [symbolTransactions]);

    // Calculate Dashboard Metrics based on FIFO results and raw transactions
    const metrics = useMemo(() => {
        let longCount = 0;
        let shortCount = 0;

        symbolTransactions.forEach(t => {
            if (t.side === 'BUY') longCount++;
            if (t.side === 'SELL') shortCount++;
        });

        // Calculate Break-even Price using Open Positions from FIFO AND Realized PnL
        // Formula: |(CurrentCostBasis - TotalRealizedPnL) / NetQty|
        // This represents the price at which the Total PnL (Realized + Unrealized) becomes 0.
        let totalCost = 0;
        let totalQty = 0;

        if (fifoResult?.openPositions) {
            fifoResult.openPositions.forEach((queue) => {
                queue.forEach(pos => {
                    totalCost += pos.qty * pos.cost;
                    totalQty += pos.qty;
                });
            });
        }

        const realizedPnl = fifoResult?.totalRealizedPnl ?? 0;
        const breakEvenPrice = totalQty !== 0 ? Math.abs((totalCost - realizedPnl) / totalQty) : 0;
        const avgCost = totalQty !== 0 ? Math.abs(totalCost / totalQty) : 0;

        return {
            longCount,
            shortCount,
            totalTrades: symbolTransactions.length,
            winCount: fifoResult?.winCount ?? 0,
            lossCount: fifoResult?.lossCount ?? 0,
            realizedPnl: fifoResult?.totalRealizedPnl ?? 0,
            breakEvenPrice,
            avgCost,
        };
    }, [symbolTransactions, fifoResult]);

    // Prepare Table Data
    const tableData: SymbolTransactionRow[] = useMemo(() => {
        if (symbolTransactions.length === 0) return [];

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const sortedTxs = [...symbolTransactions].sort((a, b) => b.transactionTimestamp - a.transactionTimestamp);

        return sortedTxs.map(t => {
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
    }, [symbolTransactions]);

    if (loading) {
        return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Loading...</div>;
    }

    return (
        <div className="flex-1 h-[calc(100vh-3rem)] bg-slate-900/30 backdrop-blur-sm rounded-2xl border border-slate-800 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Header */}
                <SymbolHeader symbol={symbol} />

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
                    <SymbolTransactionsTable data={tableData} />
                </div>
            </div>
        </div>
    );
}
