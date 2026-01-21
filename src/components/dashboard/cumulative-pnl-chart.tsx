'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, Area, ComposedChart } from 'recharts';

import { useMemo, useState } from 'react';
import { format, parseISO, startOfWeek, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { isNyTradingDay } from '@/lib/ny-time';

export function CumulativePnlChart() {
    const { dailyPnlList, loading, analysisYear } = useHoldings();
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');

    const data = useMemo(() => {
        // [FIX] Always generate a full year's range to ensure X-Axis is stable
        const targetYear = analysisYear ?? new Date().getFullYear();
        const start = new Date(targetYear, 0, 1);
        const end = new Date(targetYear, 11, 31);

        const pnlMap = new Map<string, number>();
        dailyPnlList?.forEach(item => pnlMap.set(item.date, item.pnl));

        // Generate Domain
        const result = [];
        let cursor = start;
        let runningCumulative = 0;
        let hasStarted = false;

        // Pre-calculate cumulative PnL for available days
        // We need to iterate chronologically
        // Actually, we can just iterate the cursor and look up the day's PnL

        while (cursor <= end) {
            const dateStr = format(cursor, 'yyyy-MM-dd');
            const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;

            if (!isWeekend) {
                const dayPnl = pnlMap.get(dateStr);
                const hasData = dayPnl !== undefined;

                if (hasData) {
                    runningCumulative += dayPnl;
                    hasStarted = true;
                }

                result.push({
                    date: dateStr,
                    cumulativePnl: hasData ? runningCumulative : (hasStarted ? null : null), // Stop line if no data? Or flat? User said "data hasn't arrived". stopping is better.
                    // Actually, if we want "Future" to be empty space, we just pass null.
                    hasData,
                    dateObj: new Date(cursor)
                });
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        if (viewMode === 'day') {
            return result.map(item => ({
                ...item,
                dateShort: item.date.slice(5)
            }));
        }

        // Aggregate for Week/Month (Snapshots)
        // For Cumulative, we pick the LAST value of the period
        const grouped = new Map<string, { date: string, cumulativePnl: number | null, dateShort: string }>();

        // We need to group adjacent days
        let currentPeriodKey = '';

        result.forEach(item => {
            let key: string;
            let label: string;

            if (viewMode === 'week') {
                const s = startOfWeek(item.dateObj, { weekStartsOn: 1 });
                key = format(s, 'yyyy-MM-dd');
                label = `W${format(s, 'I')}`;
            } else {
                const s = startOfMonth(item.dateObj);
                key = format(s, 'yyyy-MM-dd');
                label = format(s, 'yyyy-MM');
            }

            // Update the map with the LATEST value for this key
            // If item has data, it overwrites. If item has no data (null), we might keep previous?
            // If the whole week is future, it will stay null.
            if (!grouped.has(key)) {
                grouped.set(key, { date: key, cumulativePnl: null, dateShort: label });
            }

            // Only update if we have a valid cumulative value (or if we want to show null for future)
            // If we are in the future, item.cumulativePnl is null.
            // If we are in the past, it has value.
            // We want the last available value for the period.
            if (item.cumulativePnl !== null) {
                grouped.get(key)!.cumulativePnl = item.cumulativePnl;
            }
        });

        return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));

    }, [dailyPnlList, viewMode, analysisYear]);

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
