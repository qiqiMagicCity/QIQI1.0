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
    label: "Price",
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
              <CardTitle>Apple Inc. (AAPL)</CardTitle>
              <CardDescription>NASDAQ</CardDescription>
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
                  tickFormatter={(value) => value.slice(0, 3)}
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
                        <stop offset="5%" stopColor="var(--color-price)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="var(--color-price)" stopOpacity={0.1} />
                    </linearGradient>
                </defs>
                <Area
                  dataKey="price"
                  type="natural"
                  fill="url(#fillPrice)"
                  stroke="var(--color-price)"
                  strokeWidth={2}
                  stackId="a"
                />
              </AreaChart>
            </ChartContainer>
          </div>
          <Separator className="my-6" />
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Market Cap</span>
              <span className="font-semibold">$2.65T</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">P/E Ratio</span>
              <span className="font-semibold">28.5</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Div Yield</span>
              <span className="font-semibold">0.55%</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">52W Range</span>
              <span className="font-semibold">$124 - $198</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-4">
            <h3 className="font-semibold">Related News</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li>Apple announces new Vision Pro features coming in visionOS 2.</li>
                <li>Analysts raise AAPL price target on strong iPhone sales projections.</li>
                <li>Tim Cook to speak at upcoming AI in Tech conference.</li>
            </ul>
        </CardFooter>
      </Card>
    </section>
  );
}
