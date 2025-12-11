"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ScatterData {
    x: number; // Trading Value
    y: number; // PnL
    label: string; // Date/Period
    isHolding?: boolean; // New flag
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
                            按每日
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
                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis
                                type="number"
                                dataKey="x"
                                name="Trading Value"
                                unit="$"
                                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                                label={{
                                    value: dimension === 'day' ? 'Daily Total Volume (当日总成交额)' : 'Total Trading Value (历史总成交额)',
                                    position: 'bottom',
                                    offset: 0,
                                    fontSize: 12
                                }}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                name="PnL"
                                unit="$"
                                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                                label={{
                                    value: dimension === 'day' ? 'Daily Total PnL (当日盈亏)' : 'Total PnL (总盈亏)',
                                    angle: -90,
                                    position: 'left',
                                    offset: 0,
                                    fontSize: 12
                                }}
                            />
                            <Tooltip
                                cursor={{ strokeDasharray: '3 3' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const d = payload[0].payload as ScatterData;
                                        return (
                                            <div className="bg-popover border border-border px-4 py-3 rounded-lg shadow-xl text-sm min-w-[180px]">
                                                <p className="font-medium text-muted-foreground mb-2">
                                                    {d.label} {d.isHolding && <span className="text-sky-400 font-bold ml-1">(当前持仓)</span>}
                                                </p>
                                                <div className="space-y-2">
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">
                                                            {dimension === 'day' ? 'Daily Volume' : 'Total Trading Value'}
                                                        </p>
                                                        <p className="font-bold text-lg font-mono text-foreground">{formatCurrency(d.x)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">
                                                            {dimension === 'day'
                                                                ? 'Daily PnL'
                                                                : (d.isHolding ? 'Unrealized + Realized PnL' : 'Realized PnL')
                                                            }
                                                        </p>
                                                        <p className={`font-bold text-lg font-mono ${d.y >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {d.y >= 0 ? '+' : ''}{formatCurrency(d.y)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Scatter name="Data" data={data} fill="#8884d8">
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.y >= 0 ? "#10b981" : "#f43f5e"}
                                        stroke={entry.isHolding ? "#ffffff" : "none"}
                                        strokeWidth={entry.isHolding ? 2 : 0}
                                        fillOpacity={entry.isHolding ? 0.7 : 1}
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
