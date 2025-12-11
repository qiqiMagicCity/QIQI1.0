"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, ComposedChart, Line, ReferenceLine } from "recharts";
import { Badge } from "@/components/ui/badge";

interface StatData {
    label: string;
    value: number;
    quadrant?: string; // "High Funds High Return", etc.
}

interface AverageStatsChartProps {
    title: string;
    data: {
        weekly: StatData[];
        monthly: StatData[];
        yearly: StatData[];
    };
    type: 'pnl' | 'volume' | 'value' | 'efficiency';
}

export function AverageStatsChart({ title, data, type }: AverageStatsChartProps) {
    const isPnl = type === 'pnl';
    const isValue = type === 'value';
    const isEfficiency = type === 'efficiency';

    const formatValue = (val: number) => {
        if (isPnl || isValue) {
            return `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        }
        if (isEfficiency) {
            return `$${val.toFixed(2)}`; // PnL per $10,000
        }
        return val.toLocaleString();
    };

    const getBarColor = (val: number) => {
        if (type === 'volume') return "#8884d8"; // Volume color (Purple)
        if (isValue) return "#8884d8"; // Value color (Purple)
        // PnL and Efficiency use Green/Red
        return val >= 0 ? "#10b981" : "#f43f5e";
    };

    const getQuadrantColor = (q?: string) => {
        if (!q) return "bg-gray-500";
        if (q.includes("High Funds High Return") || q.includes("Low Funds High Return")) return "bg-emerald-500";
        if (q.includes("High Funds Low Return")) return "bg-rose-500";
        return "bg-slate-500";
    };

    const renderChart = (chartData: StatData[], label: string) => {
        if (!chartData || chartData.length === 0) {
            return (
                <div className="h-[150px] flex items-center justify-center text-muted-foreground text-xs border rounded-md bg-muted/20">
                    No Data
                </div>
            );
        }

        // --- 1. Area Chart for PnL (Green/Red Gradient) ---
        if (isPnl) {
            const dataMax = Math.max(...chartData.map((d) => d.value));
            const dataMin = Math.min(...chartData.map((d) => d.value));

            let gradientOffset = 0;
            if (dataMax <= 0) {
                gradientOffset = 0;
            } else if (dataMin >= 0) {
                gradientOffset = 1;
            } else {
                gradientOffset = dataMax / (dataMax - dataMin);
            }

            const gradId = `splitColor-${label.replace(/\s/g, '')}`;

            return (
                <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">{label}</h4>
                    <div className="h-[150px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                                <defs>
                                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset={gradientOffset} stopColor="#10b981" stopOpacity={0.6} />
                                        <stop offset={gradientOffset} stopColor="#f43f5e" stopOpacity={0.6} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="label" hide={false} minTickGap={30} tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: '#666' }} />
                                <Tooltip
                                    cursor={{ stroke: '#666', strokeWidth: 1 }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const data = payload[0].payload as StatData;
                                            return (
                                                <div className="bg-zinc-950 border border-zinc-800 px-3 py-2 rounded shadow-xl text-xs">
                                                    <p className="text-zinc-400 mb-1">{data.label}</p>
                                                    <p className={`font-bold text-base ${data.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {data.value > 0 ? '+' : ''}{formatValue(data.value)}
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#888"
                                    strokeWidth={1}
                                    fill={`url(#${gradId})`}
                                    animationDuration={1000}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            );
        }

        // --- 2. Lollipop Chart for Value (Thin Bar + Scatter Dot) ---
        if (isValue) {
            return (
                <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">{label}</h4>
                    <div className="h-[150px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                                <XAxis dataKey="label" hide={false} minTickGap={30} tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: '#666' }} />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const data = payload[0].payload as StatData;
                                            return (
                                                <div className="bg-zinc-950 border border-zinc-800 px-3 py-2 rounded shadow-xl text-xs">
                                                    <p className="text-zinc-400 mb-1">{data.label}</p>
                                                    <p className="font-bold text-base text-indigo-400">
                                                        {formatValue(data.value)}
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="value" barSize={2} fill="#818cf8" radius={[2, 2, 0, 0]} />
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke="none"
                                    dot={{ r: 3, fill: "#818cf8", strokeWidth: 0 }}
                                    activeDot={{ r: 5, fill: "#a5b4fc" }}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            );
        }

        // --- 3. Refined Bar Chart for Efficiency (Default) ---
        return (
            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">{label}</h4>
                <div className="h-[150px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                            <XAxis dataKey="label" hide={false} minTickGap={30} tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: '#666' }} />
                            <Tooltip
                                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload as StatData;
                                        return (
                                            <div className="bg-zinc-950 border border-zinc-800 px-3 py-2 rounded shadow-xl text-xs">
                                                <p className="text-zinc-400 mb-1">{data.label}</p>
                                                <p className={`font-bold text-base ${data.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {data.value >= 0 ? '+' : ''}{formatValue(data.value)}
                                                </p>
                                                {data.quadrant && (
                                                    <div className={`mt-2 text-[10px] text-white px-2 py-1 rounded-full w-fit font-medium ${getQuadrantColor(data.quadrant)}`}>
                                                        {data.quadrant}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <ReferenceLine y={0} stroke="#555" />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={getBarColor(entry.value)} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        );
    };

    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl">
            {/* Glassmorphic Header */}
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">{title}</h3>
                </div>
            </div>

            <div className="p-4">
                <div className="grid grid-cols-3 gap-4">
                    {renderChart(data.weekly, "Weekly Avg")}
                    {renderChart(data.monthly, "Monthly Avg")}
                    {renderChart(data.yearly, "Yearly Avg")}
                </div>
            </div>
        </div>
    );
}
