'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { useMemo, useState } from 'react';
import { startOfWeek, startOfMonth, format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { isNyTradingDay } from '@/lib/ny-time';

export function DailyPnlChart() {
    const { dailyPnlList, loading, analysisYear } = useHoldings();
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');

    const data = useMemo(() => {
        // [FIX] Always generate a full year's range to ensure X-Axis is stable
        const targetYear = analysisYear ?? new Date().getFullYear();
        const start = new Date(targetYear, 0, 1);
        const end = new Date(targetYear, 11, 31);
        const fullYearDays = Object.keys(dailyPnlList?.reduce((acc, item) => ({ ...acc, [item.date]: item }), {}) || {});
        // Better Strategy: Generate all dates in viewMode intervals

        const pnlMap = new Map<string, number>();
        dailyPnlList?.forEach(item => pnlMap.set(item.date, item.pnl));

        // Generate Domain
        const result = [];
        let cursor = start;

        // Define helpers
        const getIsoWeek = (d: Date) => `W${format(d, 'I')}`;
        const getMonth = (d: Date) => format(d, 'created'); // unused

        // We will generate buckets based on viewMode
        // But simply, we can iterate days and aggregate if needed.
        // Actually simplest is: Generate all days, then filter/aggregate.

        while (cursor <= end) {
            const dateStr = format(cursor, 'yyyy-MM-dd');
            // Only include Trading Days for 'day' view? User wants "Future" marked.
            // Let's include all Weekdays (Mon-Fri) as potential trading days.
            const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;

            if (!isWeekend) {
                // If viewMode is week/month, we handle differently?
                // Actually, let's keep the existing logic but just ENSURE the domain covers the year.
                // The issue is `activeData` is sliced.
                result.push({
                    date: dateStr,
                    pnl: pnlMap.get(dateStr) || 0,
                    hasData: pnlMap.has(dateStr),
                    dateObj: new Date(cursor)
                });
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        // Now aggregate based on viewMode
        if (viewMode === 'day') {
            // For day view, return full list (Mon-Fri)
            return result.map(item => ({
                ...item,
                dateShort: item.date.slice(5),
                // If no data (future), pnl is 0. Visuals handle distinction?
            }));
        }

        // Aggregate for Week/Month
        const grouped = new Map<string, { date: string, pnl: number, dateShort: string, hasData: boolean }>();

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

            if (!grouped.has(key)) {
                grouped.set(key, { date: key, pnl: 0, dateShort: label, hasData: false });
            }
            const entry = grouped.get(key)!;
            if (item.hasData) {
                entry.pnl += item.pnl;
                entry.hasData = true;
            }
        });

        return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [dailyPnlList, viewMode, analysisYear]);

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
                                {data.map((entry, index) => {
                                    // Visual logic: 
                                    // If no data (future or missing), maybe show a very faint gray?
                                    // Or just transparent? User said "mark future dates".
                                    // Let's use a faint gray for "no data" vs explicitly 0.
                                    // But dataKey is 'pnl', which is 0 for no data.
                                    // We need to check 'hasData'.
                                    // Recharts doesn't easily let us read custom props in Cell unless we hack it.
                                    // But we CAN read it from the `entry` object!
                                    // entry is the data point.

                                    const hasData = (entry as any).hasData;
                                    let fill = '#27272a'; // Zinc-800 for empty/future 

                                    if (hasData) {
                                        fill = entry.pnl >= 0 ? '#22c55e' : '#ef4444';
                                    }

                                    return <Cell key={`cell-${index}`} fill={fill} fillOpacity={hasData ? 1 : 0.3} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
