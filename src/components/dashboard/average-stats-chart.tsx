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
    analysisYear?: number;
    setAnalysisYear?: (year: number) => void;
}

export function AverageStatsChart({ title, data, type, analysisYear, setAnalysisYear }: AverageStatsChartProps) {
    const isPnl = type === 'pnl';
    const isValue = type === 'value';
    const isEfficiency = type === 'efficiency';

    // [New] Filter Data based on Analysis Year
    // Weekly and Monthly charts should focus on the selected year.
    // Yearly Chart should generally show history (or emphasize current year), but user complained about single bar.
    // So we keep Yearly UNFILTERED to show comparison.
    // We filter weekly/monthly.

    const filterByYear = (items: StatData[]) => {
        if (!analysisYear) return items;
        const yStr = String(analysisYear);
        return items.filter(item => item.label.startsWith(yStr));
    };

    const weeklyData = filterByYear(data.weekly);
    const monthlyData = filterByYear(data.monthly);
    const yearlyData = data.yearly; // Show all history

    // Derive available years from yearlyData for the switch
    const availableYears = data.yearly.map(d => parseInt(d.label, 10)).filter(y => !isNaN(y)).sort((a, b) => b - a);
    // Ensure current analysis year is in list if not found
    if (analysisYear && !availableYears.includes(analysisYear)) {
        availableYears.unshift(analysisYear);
    }
    // Fallback if no data
    if (availableYears.length === 0) {
        const now = new Date().getFullYear();
        availableYears.push(now);
        availableYears.push(now - 1);
    }

    const formatValue = (val: number) => {
        if (isPnl || isValue) {
            return `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        }
        if (isEfficiency) {
            return `${val.toFixed(2)}%`; // Daily ROI %
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
        // [FIX] Filter out leading empty periods (zeros) to auto-detect activity start
        // This matches the logic in DailyPnlChart and CumulativePnlChart
        const firstActivityIndex = chartData.findIndex(d => Math.abs(d.value) > 0.01);
        const startIndex = firstActivityIndex >= 0 ? firstActivityIndex : 0;
        const filteredData = chartData.slice(startIndex);

        if (!filteredData || filteredData.length === 0) {
            return (
                <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">{label}</h4>
                    <div className="h-[150px] flex items-center justify-center text-muted-foreground text-xs border rounded-md bg-muted/20">
                        No Data in {analysisYear}
                    </div>
                </div>
            );
        }

        // Use filteredData for all charts below
        const dataToRender = filteredData;


        // --- 1. Area Chart for PnL (Green/Red Gradient) ---
        if (isPnl) {
            const dataMax = Math.max(...dataToRender.map((d) => d.value));
            const dataMin = Math.min(...dataToRender.map((d) => d.value));

            let gradientOffset = 0;
            if (dataMax <= 0) {
                gradientOffset = 0;
            } else if (dataMin >= 0) {
                gradientOffset = 1;
            } else {
                gradientOffset = dataMax / (dataMax - dataMin);
            }

            const gradId = `splitColor-${label.replace(/\s/g, '')}-${type}`; // Unique ID

            return (
                <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">{label}</h4>
                    <div className="h-[150px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dataToRender} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
                            <ComposedChart data={dataToRender} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
                        <BarChart data={dataToRender} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
                                {dataToRender.map((entry, index) => (
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
                {/* Year Switcher */}
                {setAnalysisYear && (
                    <div className="flex items-center gap-1 bg-zinc-900/50 rounded-lg p-0.5 border border-zinc-800">
                        {availableYears.length > 0 && availableYears.map(year => (
                            <button
                                key={year}
                                onClick={() => setAnalysisYear(year)}
                                className={`
                                    px-3 py-1 text-xs font-medium rounded-md transition-all
                                    ${analysisYear === year
                                        ? "bg-zinc-800 text-zinc-100 shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                                    }
                                `}
                            >
                                {year}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="p-4">
                <div className="grid grid-cols-3 gap-4">
                    {renderChart(weeklyData, "Weekly Avg")}
                    {renderChart(monthlyData, "Monthly Avg")}
                    {renderChart(yearlyData, "Yearly Avg")}
                </div>
            </div>
        </div>
    );
}
