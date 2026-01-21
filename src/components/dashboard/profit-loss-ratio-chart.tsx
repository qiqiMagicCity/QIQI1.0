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
    analysisYear?: number;
    setAnalysisYear?: (year: number) => void;
    availableYears?: number[];
}

export function ProfitLossRatioChart({ stats, mode, onModeChange, analysisYear, setAnalysisYear, availableYears = [] }: ProfitLossRatioChartProps) {
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

                <div className="flex items-center gap-4">
                    {/* Year Switcher */}
                    {setAnalysisYear && availableYears.length > 0 && (
                        <div className="flex items-center gap-1 bg-zinc-900/50 rounded-lg p-0.5 border border-zinc-800">
                            {/* All Time Button (represented by a specific year or handled by logic? usually All Time is !analysisYear) */}
                            {/* But here analysisYear IS the state. If it's undefined, it's All Time. */}
                            {/* Wait, StockDetails probably uses current year as default or undefined? */}
                            {/* AverageStatsChart doesn't have an explicit 'All Time' button but shows 'Yearly' chart. */}
                            {/* Here we need to explicit 'All Time' or 'History'. */}
                            {/* Let's assume passed availableYears includes ALL relevant years. */}
                            {/* We add a manual 'All' button if analysisYear is optional. */}
                            <button
                                onClick={() => setAnalysisYear(0)} // 0 or undefined? setAnalysisYear usually expects number. Let's send 0 for 'All'. Parent handles it.
                                className={`
                                    px-3 py-1 text-xs font-medium rounded-md transition-all
                                    ${!analysisYear || analysisYear === 0
                                        ? "bg-zinc-800 text-zinc-100 shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                                    }
                                `}
                            >
                                全部
                            </button>
                            {availableYears.map(year => (
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
            </div>

            <div className="p-4">
                {/* Top Metrics Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-muted/30 p-3 rounded-lg border border-border/50 relative overflow-hidden">
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

                {/* Breakeven Analysis */}
                {(() => {
                    const safeAvgLoss = Math.abs(avgLoss);
                    // Avoid division by zero
                    const r = safeAvgLoss > 0 ? avgWin / safeAvgLoss : 0;
                    const beRate = r > 0 ? 1 / (1 + r) : 0;
                    const bePercent = beRate * 100;
                    const currentPercent = winRate * 100;
                    const isSafe = winRate > beRate;

                    return (
                        <div className="mb-6 px-1">
                            <div className="flex justify-between items-end mb-2">
                                <span className={!isSafe ? "text-rose-400 text-base font-bold drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]" : "text-emerald-500 text-base font-bold drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]"}>
                                    {isSafe ? "策略可持续 (盈利模式)" : "警告：策略不可持续 (亏损模式)"}
                                </span>
                                <span className="text-muted-foreground text-sm">
                                    盈亏平衡所需胜率: <span className="font-mono text-base font-bold text-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]">{bePercent.toFixed(1)}%</span>
                                </span>
                            </div>
                            <style jsx>{`
                                @keyframes pulse-glow {
                                    0% { opacity: 0.6; box-shadow: 0 0 5px rgba(16, 185, 129, 0.5); }
                                    50% { opacity: 1; box-shadow: 0 0 15px rgba(16, 185, 129, 0.8), 0 0 5px rgba(255, 255, 255, 0.5); }
                                    100% { opacity: 0.6; box-shadow: 0 0 5px rgba(16, 185, 129, 0.5); }
                                }
                            `}</style>
                            <div className="relative h-4 bg-zinc-800 rounded-full overflow-hidden">
                                {/* Current Win Rate Bar */}
                                <div
                                    className={`absolute top-0 left-0 h-full transition-all duration-500 ${isSafe ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                    style={{
                                        width: `${Math.min(currentPercent, 100)}%`,
                                        animation: isSafe ? 'pulse-glow 2s infinite ease-in-out' : 'none'
                                    }}
                                />
                                {/* Breakeven Marker */}
                                <div
                                    className="absolute top-0 h-full w-0.5 bg-white shadow-[0_0_10px_white] z-10"
                                    style={{ left: `${Math.min(bePercent, 100)}%` }}
                                />
                                {/* BE Label */}
                                <div
                                    className="absolute top-4 text-[10px] font-bold text-white -translate-x-1/2"
                                    style={{ left: `${Math.min(bePercent, 100)}%` }}
                                >
                                    BE (保本)
                                </div>
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground mt-1 font-medium">
                                <span>0%</span>
                                <span className={`text-sm font-bold text-white ${isSafe ? 'drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]' : ''}`}>当前: {(winRate * 100).toFixed(1)}%</span>
                                <span>100%</span>
                            </div>
                        </div>
                    );
                })()}

                {/* Bar Chart */}
                <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 30 }}>
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={80}
                                tickFormatter={(val) => val === 'Avg Win' ? '平均盈利' : '平均亏损'}
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
                                                <p className="font-bold mb-1">{data.name === 'Avg Win' ? '平均盈利 (Avg Win)' : '平均亏损 (Avg Loss)'}</p>
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
                    <span className="ml-2 opacity-70">(预期每笔收益 Expectancy: {formatCurrency(expectancy)})</span>
                </div>
            </div>
        </div>
    );
}
