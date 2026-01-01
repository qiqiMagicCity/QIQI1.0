'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { useMemo, useState } from 'react';
import { startOfWeek, startOfMonth, format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { isNyTradingDay } from '@/lib/ny-time';

export function DailyPnlChart() {
    const { dailyPnlList, loading } = useHoldings();
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');

    const data = useMemo(() => {
        if (!dailyPnlList || dailyPnlList.length === 0) return [];

        const sorted = [...dailyPnlList].sort((a, b) => a.date.localeCompare(b.date));

        // Filter out leading empty days
        const firstActivityIndex = sorted.findIndex(item => Math.abs(item.pnl) > 0.01);
        const startIndex = firstActivityIndex >= 0 ? firstActivityIndex : 0;

        // [FIX] Filter out weekends (Non-Trading Days)
        const activeData = sorted.slice(startIndex).filter(item => isNyTradingDay(item.date));

        if (viewMode === 'day') {
            return activeData.map(item => ({
                ...item,
                dateShort: item.date.slice(5),
            }));
        }

        // Aggregate for Week/Month
        const grouped = new Map<string, { date: string, pnl: number, dateShort: string }>();

        activeData.forEach(item => {
            const dateObj = parseISO(item.date);
            let key: string;
            let label: string;

            if (viewMode === 'week') {
                const start = startOfWeek(dateObj, { weekStartsOn: 1 }); // Monday start
                key = format(start, 'yyyy-MM-dd');
                // label = format(start, 'MM-dd'); // OLD
                label = `W${format(start, 'I')}`; // NEW: Week Number
            } else {
                const start = startOfMonth(dateObj);
                key = format(start, 'yyyy-MM-dd');
                label = format(start, 'yyyy-MM');
            }

            if (!grouped.has(key)) {
                grouped.set(key, { date: key, pnl: 0, dateShort: label });
            }
            const entry = grouped.get(key)!;
            entry.pnl += item.pnl;
        });

        return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [dailyPnlList, viewMode]);

    const chartWidth = useMemo(() => {
        const barWidth = viewMode === 'day' ? 40 : 60;
        return Math.max(viewMode === 'day' ? 1000 : 600, data.length * barWidth);
    }, [data, viewMode]);


    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl col-span-1 md:col-span-2 lg:col-span-3">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">每日盈亏情况</h3>
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
                        <BarChart data={data} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
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
                                cursor={{ fill: 'transparent' }}
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="rounded-lg border bg-background p-2 shadow-sm">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="flex flex-col">
                                                        <span className="text-[0.70rem] uppercase text-muted-foreground">
                                                            日期
                                                        </span>
                                                        <span className="font-bold text-muted-foreground">
                                                            {data.date}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[0.70rem] uppercase text-muted-foreground">
                                                            盈亏
                                                        </span>
                                                        <span className={`font-bold ${data.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            ${data.pnl.toFixed(2)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
