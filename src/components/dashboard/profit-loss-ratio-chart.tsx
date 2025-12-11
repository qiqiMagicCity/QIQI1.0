import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ProfitLossRatioChartProps {
    stats: {
        winRate: number;
        avgWin: number;
        avgLoss: number;
        pnlRatio: number;
        expectancy: number;
    };
    mode: 'realized' | 'combined';
    onModeChange: (m: 'realized' | 'combined') => void;
}

export function ProfitLossRatioChart({ stats, mode, onModeChange }: ProfitLossRatioChartProps) {
    const { winRate, avgWin, avgLoss, pnlRatio, expectancy } = stats;

    const chartData = [
        { name: 'Avg Win', value: avgWin },
        { name: 'Avg Loss', value: avgLoss }
    ];

    const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">Profit / Loss Ratio 损益比</h3>
                </div>
                {/* Toggle Switch */}
                <div className="flex items-center bg-zinc-900/50 rounded-lg p-0.5 border border-white/10">
                    <button
                        onClick={() => onModeChange('realized')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'realized'
                            ? 'bg-zinc-800 text-white shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                    >
                        已平仓
                    </button>
                    <button
                        onClick={() => onModeChange('combined')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'combined'
                            ? 'bg-zinc-800 text-emerald-400 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                    >
                        含持仓
                    </button>
                </div>
            </div>

            <div className="p-4">
                {/* Top Metrics Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1">Win Rate 胜率</p>
                        <p className="text-xl font-bold font-mono text-emerald-500">{(winRate * 100).toFixed(1)}%</p>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1">Avg Win 平均获利</p>
                        <p className="text-xl font-bold font-mono text-emerald-500">{formatCurrency(avgWin)}</p>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1">Avg Loss 平均亏损</p>
                        <p className="text-xl font-bold font-mono text-rose-500">{formatCurrency(avgLoss)}</p>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1">P/L Ratio 损益比</p>
                        <p className="text-xl font-bold font-mono text-sky-500">{pnlRatio.toFixed(2)} : 1</p>
                    </div>
                </div>

                {/* Bar Chart */}
                <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 30 }}>
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={80}
                                tick={{ fontSize: 12, fill: '#888888' }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                cursor={{ fill: 'transparent' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-popover border border-border px-3 py-2 rounded shadow-lg text-xs">
                                                <p className="font-bold mb-1">{data.name}</p>
                                                <p className="font-mono">{formatCurrency(data.value)}</p>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={30}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.name === 'Avg Win' ? '#10b981' : '#f43f5e'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Footer Text */}
                <div className="mt-4 text-xs text-center text-muted-foreground">
                    损益比 &gt; 1 表示平均盈利大于平均亏损；损益比 &lt; 1 表示平均亏损大于平均盈利。
                    <span className="ml-2 opacity-70">(Expectancy: {formatCurrency(expectancy)})</span>
                </div>
            </div>
        </div>
    );
}
