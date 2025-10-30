"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { stockChartData } from "@/lib/data";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Separator } from "../ui/separator";

const chartConfig = {
  price: {
    label: "价格",
    color: "hsl(var(--chart-1))",
  },
};

export function StockDetails() {
  return (
    <section id="details" className="scroll-mt-20">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>苹果公司 (AAPL)</CardTitle>
              <CardDescription>纳斯达克</CardDescription>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold">$170.00</p>
              <p className="text-sm text-destructive font-medium">-2.50 (-1.45%)</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ChartContainer config={chartConfig}>
              <AreaChart
                accessibilityLayer
                data={stockChartData}
                margin={{
                  left: -10,
                  right: 12,
                  top: 12
                }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                 <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  domain={['dataMin - 20', 'dataMax + 20']}
                  tickFormatter={(value) => `$${value}`}
                />
                <ChartTooltip
                  cursor={true}
                  content={<ChartTooltipContent indicator="dot" />}
                />
                <defs>
                    <linearGradient id="fillPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.1} />
                    </linearGradient>
                </defs>
                <Area
                  dataKey="price"
                  type="natural"
                  fill="url(#fillPrice)"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  stackId="a"
                />
              </AreaChart>
            </ChartContainer>
          </div>
          <Separator className="my-6" />
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">市值</span>
              <span className="font-semibold">$2.65T</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">市盈率</span>
              <span className="font-semibold">28.5</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">股息率</span>
              <span className="font-semibold">0.55%</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">52周范围</span>
              <span className="font-semibold">$124 - $198</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-4">
            <h3 className="font-semibold">相关新闻</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li>苹果宣布 visionOS 2 将推出新的 Vision Pro 功能。</li>
                <li>分析师因 iPhone 销售预测强劲而上调 AAPL 目标价。</li>
                <li>蒂姆·库克将在即将举行的 AI in Tech 会议上发表演讲。</li>
            </ul>
        </CardFooter>
      </Card>
    </section>
  );
}
