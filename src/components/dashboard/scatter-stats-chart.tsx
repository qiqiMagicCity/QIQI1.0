"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

interface ScatterData {
    x: number; // Trading Value
    y: number; // PnL or ROI
    z?: number; // Bubble Size (Ticket Count)
    roi?: number; // Explicit ROI for tooltip
    pnl?: number; // Explicit PnL for tooltip
    label: string; // Date/Period
    isHolding?: boolean;
}

interface ScatterStatsChartProps {
    title: string;
    data: ScatterData[];
    mode: 'realized' | 'combined';
    onModeChange: (m: 'realized' | 'combined') => void;
    dimension?: 'symbol' | 'day';
    onDimensionChange?: (d: 'symbol' | 'day') => void;
}

export function ScatterStatsChart({ title, data, mode, onModeChange, dimension = 'symbol', onDimensionChange }: ScatterStatsChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <h3 className="text-sm font-medium tracking-wide text-zinc-100">{title}</h3>
                    </div>
                </div>
                <div className="p-4">
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm border rounded-md bg-muted/20">
                        No Data Available
                    </div>
                </div>
            </div>
        );
    }

    const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    const formatPercent = (val: number) => `${val.toFixed(2)}%`;

    // Determine Axis configurations based on dimension
    const isDay = dimension === 'day';
    const yAxisLabel = isDay ? 'Daily ROI (%)' : (dimension === 'symbol' ? 'Total PnL (盈亏)' : 'PnL');
    const yAxisFormatter = isDay ? (val: number) => `${val}%` : (val: number) => `$${(val / 1000).toFixed(0)}k`;

    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">{title}</h3>
                </div>

                <div className="flex items-center gap-3">
                    {/* Dimension Selector */}
                    <div className="flex items-center bg-zinc-900/50 rounded-lg p-0.5 border border-white/10">
                        <button
                            onClick={() => onDimensionChange?.('symbol')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${dimension === 'symbol'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            按标的
                        </button>
                        <button
                            onClick={() => onDimensionChange?.('day')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${dimension === 'day'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            按每日(ROI)
                        </button>
                    </div>

                    {/* Mode Switch - Show for both views now */}
                    <div className="flex items-center bg-zinc-900/50 rounded-lg p-0.5 border border-white/10">
                        <button
                            onClick={() => onModeChange('realized')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'realized'
                                ? 'bg-zinc-800 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            {dimension === 'day' ? '仅已平仓' : '已平仓'}
                        </button>
                        <button
                            onClick={() => onModeChange('combined')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'combined'
                                ? 'bg-zinc-800 text-emerald-400 shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            {dimension === 'day' ? '全账户' : '含持仓'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-4">
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis
                                type="number"
                                dataKey="x"
                                name="Trading Value"
                                unit="$"
                                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                                label={{
                                    value: dimension === 'day' ? 'Daily Total Volume' : 'Total Trading Value',
                                    position: 'bottom',
                                    offset: 0,
                                    fontSize: 12
                                }}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                name="Y-Value"
                                tickFormatter={yAxisFormatter}
                                label={{
                                    value: yAxisLabel,
                                    angle: -90,
                                    position: 'insideLeft',
                                    offset: 10,
                                    fontSize: 12,
                                    style: { textAnchor: 'middle' }
                                }}
                            />
                            <ZAxis type="number" dataKey="z" range={[50, 400]} name="Trades" unit="" />
                            <Tooltip
                                cursor={{ strokeDasharray: '3 3' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const d = payload[0].payload as ScatterData;
                                        return (
                                            <div className="bg-popover border border-border px-4 py-3 rounded-lg shadow-xl text-sm min-w-[200px]">
                                                <p className="font-medium text-muted-foreground mb-2">
                                                    {d.label} {d.isHolding && <span className="text-sky-400 font-bold ml-1">(Holding)</span>}
                                                </p>
                                                <div className="space-y-1">
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Volume:</span>
                                                        <span className="font-mono text-zinc-100">{formatCurrency(d.x)}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">PnL:</span>
                                                        <span className={`font-mono font-bold ${d.pnl && d.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {formatCurrency(d.pnl || d.y)} {/* Fallback to y if pnl not explicit */}
                                                        </span>
                                                    </div>
                                                    {isDay && (
                                                        <div className="flex justify-between">
                                                            <span className="text-muted-foreground">ROI:</span>
                                                            <span className={`font-mono font-bold ${d.y >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                {formatPercent(d.y)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {d.z && (
                                                        <div className="flex justify-between mt-1 pt-1 border-t border-border/50">
                                                            <span className="text-muted-foreground">Tickets:</span>
                                                            <span className="font-mono text-zinc-100">{d.z} trades</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            {/* Breakeven Line */}
                            {isDay && <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />}

                            <Scatter name="Data" data={data} fill="#8884d8">
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.pnl ? (entry.pnl >= 0 ? "#10b981" : "#f43f5e") : (entry.y >= 0 ? "#10b981" : "#f43f5e")}
                                        stroke={entry.isHolding ? "#ffffff" : "none"}
                                        strokeWidth={entry.isHolding ? 2 : 0}
                                        fillOpacity={entry.isHolding ? 0.7 : 0.8}
                                    />
                                ))}
                            </Scatter>
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
