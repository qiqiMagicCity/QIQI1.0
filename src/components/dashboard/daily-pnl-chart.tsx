'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DailyPnlChart() {
    const { dailyPnlList, loading } = useHoldings();

    if (loading) {
        return (
            <Card className="h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">加载中...</div>
            </Card>
        );
    }

    if (!dailyPnlList || dailyPnlList.length === 0) {
        return (
            <Card className="h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">暂无每日盈亏数据</div>
            </Card>
        );
    }

    // Format dates for X-axis (MM-DD)
    const data = dailyPnlList.map(item => ({
        ...item,
        dateShort: item.date.slice(5), // Remove YYYY-
    }));

    return (
        <Card className="col-span-1 md:col-span-2 lg:col-span-3">
            <CardHeader>
                <CardTitle>每日盈亏情况</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
        </Card>
    );
}
