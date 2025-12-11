'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DailyPnlChart() {
    const { dailyPnlList, loading } = useHoldings();

    if (loading) {
        return (
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">加载中...</div>
            </div>
        );
    }

    if (!dailyPnlList || dailyPnlList.length === 0) {
        return (
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">暂无每日盈亏数据</div>
            </div>
        );
    }

    // Format dates for X-axis (MM-DD)
    const data = dailyPnlList.map(item => ({
        ...item,
        dateShort: item.date.slice(5), // Remove YYYY-
    }));

    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl col-span-1 md:col-span-2 lg:col-span-3">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">每日盈亏情况</h3>
                </div>
            </div>

            <div className="p-4">
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis
                                dataKey="dateShort"
                                stroke="#888888"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis
                                stroke="#888888"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `$${value}`}
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
