import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ScatterData {
    x: number; // Trading Value
    y: number; // PnL
    label: string; // Date/Period
}

interface ScatterStatsChartProps {
    title: string;
    data: ScatterData[];
}

export function ScatterStatsChart({ title, data }: ScatterStatsChartProps) {
    if (!data || data.length === 0) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm border rounded-md bg-muted/20">
                        No Data Available
                    </div>
                </CardContent>
            </Card>
        );
    }

    const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold">{title}</CardTitle>
            </CardHeader>
            <CardContent>
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
                                label={{ value: 'Avg. Trading Value (Daily)', position: 'bottom', offset: 0, fontSize: 12 }}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                name="PnL"
                                unit="$"
                                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                                label={{ value: 'Avg. PnL (Daily)', angle: -90, position: 'left', offset: 0, fontSize: 12 }}
                            />
                            <Tooltip
                                cursor={{ strokeDasharray: '3 3' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const d = payload[0].payload;
                                        return (
                                            <div className="bg-popover border border-border px-4 py-3 rounded-lg shadow-xl text-sm min-w-[180px]">
                                                <p className="font-medium text-muted-foreground mb-2">{d.label}</p>
                                                <div className="space-y-2">
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">Trading Value</p>
                                                        <p className="font-bold text-lg font-mono text-foreground">{formatCurrency(d.x)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">PnL</p>
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
                            <Scatter name="Periods" data={data} fill="#8884d8">
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.y >= 0 ? "#10b981" : "#f43f5e"} />
                                ))}
                            </Scatter>
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
