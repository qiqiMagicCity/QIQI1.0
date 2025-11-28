'use client';

import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { SymbolSidebar } from '@/components/symbol/symbol-sidebar';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useUser } from '@/firebase';
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo';
import { nowNyCalendarDayString } from '@/lib/ny-time';

export default function SymbolLayout({ children }: { children: React.ReactNode }) {
    const params = useParams();
    // Handle potential array or undefined param, though usually string in this route
    const currentSymbol = typeof params?.symbol === 'string' ? params.symbol.toUpperCase() : '';

    const { user } = useUser();
    const { data: transactions } = useUserTransactions(user?.uid);

    const sidebarItems = useMemo(() => {
        if (!transactions || transactions.length === 0) return [];

        // 1. Group transactions by distinct asset (Stock vs Option)
        // Key format: "SYMBOL" for stock, "SYMBOL Options" for options
        const groups = new Map<string, typeof transactions>();

        transactions.forEach(t => {
            const root = t.symbol.split(' ')[0];
            // Determine grouping key
            let key = root;
            if (t.assetType === 'option') {
                key = `${root} Options`;
            }

            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(t);
        });

        // 2. Process each group: Count txs & Calculate PnL
        const items = Array.from(groups.entries()).map(([displayName, txs]) => {
            // Calculate PnL to check for realized loss/profit
            const fifoResult = calcGlobalFifo({
                transactions: txs,
                todayNy: nowNyCalendarDayString(),
            });

            const pnl = fifoResult.totalRealizedPnl;

            return {
                symbol: displayName, // This is now "QQQ" or "QQQ Options"
                count: txs.length,
                hasLoss: pnl < -0.01,
                hasProfit: pnl > 0.01,
            };
        });

        // 3. Sort by transaction count (descending)
        return items.sort((a, b) => b.count - a.count);
    }, [transactions]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-6 flex flex-row gap-6 overflow-hidden">
            {/* Sidebar (Floating Panel) - Persistent across symbol changes */}
            <div className="w-[480px] shrink-0 h-[calc(100vh-3rem)]">
                <SymbolSidebar items={sidebarItems} currentSymbol={currentSymbol} />
            </div>

            {/* Main Content Area (Floating Panel) */}
            {children}
        </div>
    );
}
