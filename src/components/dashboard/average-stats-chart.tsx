import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
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

        return (
            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">{label}</h4>
                <div className="h-[150px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                            <XAxis
                                dataKey="label"
                                hide
                            />
                            <Tooltip
                                cursor={{ fill: 'transparent' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload as StatData;
                                        return (
                                            <div className="bg-popover border border-border px-4 py-3 rounded-lg shadow-xl text-sm min-w-[150px]">
                                                <p className="font-medium text-muted-foreground mb-1">{data.label}</p>
                                                <p className={`font-bold text-xl ${data.value >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {isPnl || isEfficiency ? (data.value >= 0 ? '+' : '') : ''}{formatValue(data.value)}
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
                            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
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
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-3 gap-4">
                    {renderChart(data.weekly, "Weekly Avg")}
                    {renderChart(data.monthly, "Monthly Avg")}
                    {renderChart(data.yearly, "Yearly Avg")}
                </div>
            </CardContent>
        </Card>
    );
}
