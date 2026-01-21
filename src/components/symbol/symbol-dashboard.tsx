'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SymbolDashboardProps {
    longCount: number;
    shortCount: number;
    totalTrades: number;
    winCount: number;
    lossCount: number;
    realizedPnl: number;
    unrealizedPnl?: number;
    breakEvenPrice?: number;
    avgCost?: number;
    lastTrade?: {
        side: string;
        price: number;
    };
}

export function SymbolDashboard({
    longCount,
    shortCount,
    totalTrades,
    winCount,
    lossCount,
    realizedPnl,
    unrealizedPnl,
    breakEvenPrice,
    avgCost,
    lastTrade,
}: SymbolDashboardProps) {
    const winRate = (winCount + lossCount) > 0
        ? Math.round((winCount / (winCount + lossCount)) * 100)
        : 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Trade Counts */}
            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">做多次数</span>
                    <span className="text-2xl font-bold text-emerald-400">{longCount}</span>
                </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">做空次数</span>
                    <span className="text-2xl font-bold text-red-400">{shortCount}</span>
                </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">个股交易次数</span>
                    <span className="text-2xl font-bold text-white">{totalTrades}</span>
                </CardContent>
            </Card>

            {/* Win Rate */}
            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">胜率</span>
                    <div className="flex items-baseline gap-2">
                        <div className="flex items-baseline gap-1 text-xl font-bold font-mono">
                            <span className="text-emerald-400">W{winCount}</span>
                            <span className="text-slate-600">/</span>
                            <span className="text-red-400">L{lossCount}</span>
                        </div>
                        <span className="text-sm text-slate-500 font-mono">
                            {winRate}%
                        </span>
                    </div>
                </CardContent>
            </Card>

            {/* Realized PnL */}
            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">个股已实现盈亏</span>
                    <span className={cn(
                        "text-2xl font-bold font-mono",
                        realizedPnl > 0 ? "text-emerald-400" : realizedPnl < 0 ? "text-red-400" : "text-slate-200"
                    )}>
                        {realizedPnl > 0 ? '+' : ''}{realizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </CardContent>
            </Card>

            {/* Average Cost */}
            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">持仓均价 (当前)</span>
                    <span className="text-2xl font-bold text-amber-400 font-mono">
                        {avgCost ? avgCost.toFixed(2) : '-'}
                    </span>
                </CardContent>
            </Card>

            {/* Break-even Point */}
            <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                    <span className="text-slate-400 text-sm font-medium">综合保本价 (含历史)</span>
                    <span className="text-2xl font-bold text-blue-400 font-mono">
                        {breakEvenPrice ? breakEvenPrice.toFixed(2) : '-'}
                    </span>
                </CardContent>
            </Card>

            {/* Unrealized PnL (Floating) - Only visible if there is an open position (unrealizedPnl is provided) */}
            {unrealizedPnl !== undefined && unrealizedPnl !== null ? (
                <Card className="bg-slate-900/50 border-slate-800">
                    <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                        <span className="text-slate-400 text-sm font-medium">持有浮动盈亏 (未实现)</span>
                        <span className={cn(
                            "text-2xl font-bold font-mono",
                            unrealizedPnl > 0 ? "text-emerald-400" : unrealizedPnl < 0 ? "text-red-400" : "text-slate-200"
                        )}>
                            {unrealizedPnl > 0 ? '+' : ''}{unrealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </CardContent>
                </Card>
            ) : (
                /* Last Trade - Only visible if Position is Closed (unrealizedPnl is null/undefined) AND lastTrade exists */
                lastTrade && (
                    <Card className="bg-slate-900/50 border-slate-800">
                        <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
                            <span className="text-slate-400 text-sm font-medium">最后一次成交</span>
                            <div className="flex flex-col items-center">
                                <span className={cn(
                                    "text-lg font-bold mb-1",
                                    lastTrade.side === 'BUY' ? "text-emerald-400" : "text-red-400"
                                )}>
                                    {lastTrade.side === 'BUY' ? '买入' : '卖出'}
                                </span>
                                <span className="text-2xl font-bold font-mono text-white">
                                    {lastTrade.price.toFixed(2)}
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                )
            )}
        </div>
    );
}
