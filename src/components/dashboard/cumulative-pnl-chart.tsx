'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, Area, ComposedChart } from 'recharts';

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { isNyTradingDay } from '@/lib/ny-time';

export function CumulativePnlChart() {
    const { dailyPnlList, loading } = useHoldings();
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');

    const data = useMemo(() => {
        if (!dailyPnlList || dailyPnlList.length === 0) return [];

        let cumulative = 0;
        const sorted = [...dailyPnlList].sort((a, b) => a.date.localeCompare(b.date));

        // Filter out leading empty days
        const firstActivityIndex = sorted.findIndex(item => Math.abs(item.pnl) > 0.01);
        const startIndex = firstActivityIndex >= 0 ? firstActivityIndex : 0;
        const activeRange = sorted.slice(startIndex);

        // 1. Base Series (Daily Cumulative)
        const dailySeries = activeRange.map(item => {
            cumulative += item.pnl;
            return {
                ...item,
                dateObj: parseISO(item.date),
                cumulativePnl: cumulative
            };
        });

        // [FIX] Filter out weekends (Non-Trading Days)
        // User wants to see continuous trading days.
        const tradingDays = dailySeries.filter(d => isNyTradingDay(d.date));

        if (viewMode === 'day') {
            return tradingDays.map(item => ({
                ...item,
                dateShort: item.date.slice(5)
            }));
        }

        // 2. Filter for Week/Month (Snapshots)
        // We take the last available data point of each period to represent the "closing" state of that period.
        return tradingDays.filter((d, index, array) => {
            const nextItem = array[index + 1];
            if (!nextItem) return true; // Always include the very last point (Today)

            if (viewMode === 'week') {
                const thisWeek = format(d.dateObj, 'yyyy-II'); // ISO Week
                const nextWeek = format(nextItem.dateObj, 'yyyy-II');
                // Check if week changed
                return thisWeek !== nextWeek;
            } else {
                const thisMonth = format(d.dateObj, 'yyyy-MM');
                const nextMonth = format(nextItem.dateObj, 'yyyy-MM');
                return thisMonth !== nextMonth;
            }
        }).map(item => {
            let label = item.date.slice(5);
            if (viewMode === 'week') {
                label = `W${format(item.dateObj, 'I')}`;
            } else if (viewMode === 'month') {
                label = format(item.dateObj, 'MMM');
            }

            return {
                ...item,
                dateShort: label
            };
        });

    }, [dailyPnlList, viewMode]);

    const chartWidth = useMemo(() => {
        if (!data || data.length === 0) return '100%';
        const pointWidth = viewMode === 'day' ? 50 : 80;
        return Math.max(viewMode === 'day' ? 1000 : 600, data.length * pointWidth);
    }, [data, viewMode]);

    if (loading) {
        return (
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">加载中...</div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">暂无累计盈亏数据</div>
            </div>
        );
    }

    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl col-span-1 md:col-span-2 lg:col-span-3">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">累计盈亏趋势 (Cumulative PnL)</h3>
                </div>

                <div className="flex items-center gap-1 bg-zinc-900/50 rounded-lg p-0.5 border border-zinc-800">
                    {(['day', 'week', 'month'] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => setViewMode(m)}
                            className={cn(
                                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                                viewMode === m
                                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                            )}
                        >
                            {m === 'day' ? '日' : m === 'week' ? '周' : '月'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-4 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                <div className="h-[300px]" style={{ minWidth: '100%', width: chartWidth }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" opacity={0.1} />
                            <XAxis
                                dataKey="dateShort"
                                stroke="#888888"
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                interval={0}
                                angle={-45}
                                textAnchor="end"
                                height={60}
                            />
                            <YAxis
                                stroke="#888888"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
                                width={60}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                                itemStyle={{ color: '#e4e4e7' }}
                                labelStyle={{ color: '#a1a1aa' }}
                                formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '累计盈亏']}
                            />
                            <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                            <Area
                                type="linear"
                                dataKey="cumulativePnl"
                                stroke="#3b82f6"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorPnl)"
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
