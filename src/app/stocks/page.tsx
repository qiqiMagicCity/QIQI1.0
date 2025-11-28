'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useUser } from '@/firebase';
import { Card, CardContent } from '@/components/ui/card';

export default function StocksPage() {
    const { user } = useUser();
    const { data: transactions, loading } = useUserTransactions(user?.uid);

    // Extract unique symbols
    const uniqueSymbols = useMemo(() => {
        if (!transactions) return [];
        const symbols = new Set(transactions.map(t => t.symbol));
        return Array.from(symbols).sort();
    }, [transactions]);

    if (loading) {
        return <div className="p-8 text-center text-slate-400">Loading stocks...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-8">
            <h1 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
                <div className="h-8 w-1.5 bg-emerald-500 rounded-full" />
                所有标的 ({uniqueSymbols.length})
            </h1>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {uniqueSymbols.map(symbol => (
                    <Link key={symbol} href={`/symbol/${symbol}`}>
                        <Card className="hover:bg-slate-800/50 transition-all cursor-pointer border-slate-800 bg-slate-900/30 group">
                            <CardContent className="p-6 flex flex-col items-center justify-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-lg font-bold text-emerald-500 group-hover:scale-110 transition-transform">
                                    {symbol.slice(0, 1)}
                                </div>
                                <span className="font-bold text-lg text-slate-200 group-hover:text-emerald-400 transition-colors">
                                    {symbol}
                                </span>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );
}
