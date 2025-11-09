'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHoldings } from "@/hooks/use-holdings";
import { StatusBadge } from "@/components/ui/status-badge";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const formatCurrency = (value: number) => {
  const sign = value > 0 ? '+' : '';
  return sign + value.toFixed(2);
};

export function CalculationGrid() {
  const { summary, loading } = useHoldings();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-5 w-5" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-3/5" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const showTodayPlNumber =
    (summary?.aggTodayPlStatus === 'live' || summary?.aggTodayPlStatus === 'closed') &&
    typeof summary?.totalTodayPl === 'number';

  const metrics = [
    {
      title: "持仓市值",
      value: summary.totalMv != null ? summary.totalMv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—',
      icon: DollarSign,
    },
    {
      title: "持仓总盈亏",
      value: summary.totalPnl != null ? formatCurrency(summary.totalPnl) : '—',
      icon: summary.totalPnl == null || summary.totalPnl >= 0 ? TrendingUp : TrendingDown,
      valueCls: summary.totalPnl != null ? (summary.totalPnl > 0 ? 'text-success' : 'text-destructive') : '',
    },
    {
      title: "今日盈亏",
      value: showTodayPlNumber
        ? formatCurrency(summary.totalTodayPl!)
        : <StatusBadge status={summary?.aggTodayPlStatus ?? 'degraded'} />,
      icon: summary.totalTodayPl == null || summary.totalTodayPl >= 0 ? TrendingUp : TrendingDown,
      valueCls: showTodayPlNumber && summary.totalTodayPl != null ? (summary.totalTodayPl > 0 ? 'text-success' : 'text-destructive') : '',
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      {metrics.map((metric) => (
        <Card key={metric.title} className="transition-all hover:shadow-lg hover:-translate-y-1 bg-background">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{metric.title}</CardTitle>
            <metric.icon className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", typeof metric.value === 'string' && metric.valueCls)}>
              {metric.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}