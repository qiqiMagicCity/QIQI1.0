'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LucideIcon,
  CheckCircle2,
  Activity,
  BarChart2,
  History,
  Wallet,
  Trophy,
  CalendarDays,
  Calendar,
  CalendarRange,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

interface MetricSubItem {
  label: string;
  value: number | null;
  formattedValue: string | React.ReactNode;
}

interface MetricItem {
  title: string;
  icon: LucideIcon;
  theme: string;
  value?: number | null;
  formattedValue?: string | React.ReactNode;
  subItems?: MetricSubItem[];
  isPnl?: boolean;
}

export function CalculationGrid() {
  const { summary, loading } = useHoldings();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={`r1-${i}`} className="min-h-[120px] border-none shadow-sm bg-muted/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-5 w-5 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:w-3/4 lg:mx-auto">
          {[...Array(3)].map((_, i) => (
            <Card key={`r2-${i}`} className="min-h-[120px] border-none shadow-sm bg-muted/20">
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:w-3/4 lg:mx-auto">
          {[...Array(3)].map((_, i) => (
            <Card key={`r3-${i}`} className="min-h-[120px] border-none shadow-sm bg-muted/20">
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  // Helper to get PnL color text
  const getPnLColor = (val: number | null | undefined) => {
    if (val == null) return "text-muted-foreground";
    if (val > 0) return "text-emerald-700 dark:text-emerald-400";
    if (val < 0) return "text-red-700 dark:text-red-400";
    return "text-muted-foreground";
  };

  // Helper to get Card Theme Styles - Unified Sky Blue Theme (Light) / Neutral (Dark)
  const getThemeStyles = (color: string) => {
    return {
      bg: "bg-sky-100 dark:bg-card",
      border: "border-sky-200 dark:border-border",
      iconBg: "bg-white/80 dark:bg-muted",
      iconColor: "text-sky-700 dark:text-foreground",
    };
  };

  // Helper to render Trade Counts Row
  const renderTradeCountsRow = (counts: { buy: number; sell: number; short: number; cover: number; total: number } | undefined, label: string) => (
    <div className="flex items-center text-xs font-mono w-full">
      <span className="w-8 text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center justify-between flex-1 pr-0">
        <span className="text-green-600 font-bold w-[2.8rem]">B/{counts?.buy ?? 0}</span>
        <span className="text-red-600 font-bold w-[2.8rem]">S/{counts?.sell ?? 0}</span>
        <span className="text-purple-600 font-bold w-[2.8rem]">P/{counts?.short ?? 0}</span>
        <span className="text-blue-600 font-bold w-[2.8rem]">C/{counts?.cover ?? 0}</span>
        <span className="text-foreground font-bold w-[3rem] text-right">【{counts?.total ?? 0}】</span>
      </div>
    </div>
  );

  // Helper to render Win Rate Row
  const renderWinRateRow = (stats: { winCount: number; lossCount: number; winRate: number } | undefined, label: string) => (
    <div className="flex items-center text-xs font-mono w-full">
      <span className="w-8 text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-green-600 font-bold w-[3rem]">W/{stats?.winCount ?? 0}</span>
        <span className="text-red-600 font-bold w-[3rem]">L/{stats?.lossCount ?? 0}</span>
        <span className="text-foreground font-bold w-[3.5rem]">{(stats?.winRate ? (stats.winRate * 100).toFixed(1) : "0.0")}%</span>
      </div>
    </div>
  );

  // Define the 10 metrics with their themes
  const metricsData: MetricItem[] = [
    // 1. 今日平仓盈利(历史仓位)
    {
      title: "今日平仓盈利 (历史仓位)",
      value: summary.m4_historicalRealized,
      formattedValue: summary.m4_historicalRealized != null ? formatCurrency(summary.m4_historicalRealized) : "—",
      icon: CheckCircle2,
      theme: 'emerald',
      isPnl: true,
    },
    // 2. 今日交易盈利(日内交易)
    {
      title: "今日交易盈利 (日内交易)",
      icon: Activity,
      theme: 'blue',
      subItems: [
        {
          label: "交易视角",
          value: summary.m5_1_trading,
          formattedValue: summary.m5_1_trading != null ? formatCurrency(summary.m5_1_trading) : "—",
        },
        {
          label: "账本视角",
          value: summary.m5_2_ledger,
          formattedValue: summary.m5_2_ledger != null ? formatCurrency(summary.m5_2_ledger) : "—",
        },
      ],
    },
    // 3. 当日盈亏情况 (Total Today PnL)
    {
      title: "当日盈亏情况",
      value: summary.m6_total,
      formattedValue: summary.m6_total != null ? formatCurrency(summary.m6_total) : "—",
      icon: Activity,
      theme: 'cyan',
      isPnl: true,
      subItems: [
        {
          label: "存量盈亏",
          value: summary.m6_1_legacy,
          formattedValue: summary.m6_1_legacy != null ? formatCurrency(summary.m6_1_legacy) : "—",
        },
        {
          label: "增量盈亏",
          value: summary.m6_2_new,
          formattedValue: summary.m6_2_new != null ? formatCurrency(summary.m6_2_new) : "—",
        },
      ],
    },
    // 4. 今日交易次数(分类统计)
    {
      title: "今日交易次数 (分类统计)",
      value: null,
      formattedValue: (
        <div className="flex items-center gap-1 text-lg font-mono">
          <span className="text-green-600 font-bold">B/{summary.todayTradeCounts?.buy ?? 0}</span>
          <span className="mx-1"> </span>
          <span className="text-red-600 font-bold">S/{summary.todayTradeCounts?.sell ?? 0}</span>
          <span className="mx-1"> </span>
          <span className="text-purple-600 font-bold">P/{summary.todayTradeCounts?.short ?? 0}</span>
          <span className="mx-1"> </span>
          <span className="text-blue-600 font-bold">C/{summary.todayTradeCounts?.cover ?? 0}</span>
          <span className="mx-1"> </span>
          <span className="text-foreground font-bold">【{summary.todayTradeCounts?.total ?? 0}】</span>
        </div>
      ),
      icon: BarChart2,
      theme: 'orange',
      isPnl: false,
    },
    // 5. 累计交易次数 (M8)
    {
      title: "累计交易次数",
      value: null,
      formattedValue: (
        <div className="flex flex-col gap-1">
          {renderTradeCountsRow(summary.totalTradeCounts, "总计")}
          {renderTradeCountsRow(summary.wtdTradeCounts, "本周")}
          {renderTradeCountsRow(summary.mtdTradeCounts, "本月")}
        </div>
      ),
      icon: History,
      theme: 'purple',
      isPnl: false,
    },
    // 6. 累计已实现盈利 (M9)
    {
      title: "累计已实现盈利",
      value: summary.totalHistoricalRealizedPnl,
      formattedValue: formatCurrency(summary.totalHistoricalRealizedPnl ?? 0),
      icon: Wallet,
      theme: 'amber',
      isPnl: true,
    },
    // 7. 胜率 (M10)
    {
      title: "胜率",
      value: null,
      formattedValue: (
        <div className="flex flex-col gap-1">
          {renderWinRateRow(summary.winRateStats, "总计")}
          {renderWinRateRow(summary.wtdWinRateStats, "本周")}
          {renderWinRateRow(summary.mtdWinRateStats, "本月")}
        </div>
      ),
      icon: Trophy,
      theme: 'rose',
      isPnl: false,
    },
    // 8. WTD
    {
      title: "WTD (本周累计盈利)",
      value: summary.wtdPnl,
      formattedValue: summary.wtdPnl != null ? formatCurrency(summary.wtdPnl) : "—",
      icon: CalendarDays,
      theme: 'sky',
      isPnl: true,
    },
    // 9. MTD
    {
      title: "MTD (本月累计盈利)",
      value: summary.mtdPnl,
      formattedValue: summary.mtdPnl != null ? formatCurrency(summary.mtdPnl) : "—",
      icon: Calendar,
      theme: 'indigo',
      isPnl: true,
    },
    // 10. YTD
    {
      title: "YTD (本年累计盈利)",
      value: summary.ytdPnl,
      formattedValue: summary.ytdPnl != null ? formatCurrency(summary.ytdPnl) : "—",
      icon: CalendarRange,
      theme: 'violet',
      isPnl: true,
    },
  ];

  // Split metrics into rows: 4 - 3 - 3
  const row1Metrics = metricsData.slice(0, 4);
  const row2Metrics = metricsData.slice(4, 7);
  const row3Metrics = metricsData.slice(7, 10);

  const renderMetricCard = (metric: MetricItem, idx: number) => {
    const styles = getThemeStyles(metric.theme);
    return (
      <Card
        key={idx}
        className={cn(
          "relative overflow-hidden transition-all duration-200 hover:shadow-md border",
          styles.bg,
          styles.border
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-bold text-foreground/80 tracking-tight">
            {metric.title}
          </CardTitle>
          <div className={cn("p-1.5 rounded-full", styles.iconBg)}>
            <metric.icon className={cn("h-4 w-4", styles.iconColor)} />
          </div>
        </CardHeader>
        <CardContent>
          {/* Render Main Value if present */}
          {(metric.formattedValue && metric.value !== undefined) ? (
            metric.title.includes("历史仓位") && summary.m4_auditTrail && summary.m4_auditTrail.length > 0 ? (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "text-2xl font-bold font-mono tracking-tight mb-2 cursor-help decoration-dashed underline-offset-4 decoration-muted-foreground/30",
                        metric.isPnl ? getPnLColor(metric.value) : "text-foreground"
                      )}
                    >
                      {metric.formattedValue}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="p-0 border-none bg-popover text-popover-foreground shadow-xl">
                    <div className="w-[400px] rounded-md border bg-card text-card-foreground">
                      <div className="p-3 border-b bg-muted/30">
                        <h4 className="font-semibold text-sm">今日平仓详情 (历史仓位)</h4>
                      </div>
                      <ScrollArea className="h-[300px]">
                        <div className="p-2 space-y-1">
                          {summary.m4_auditTrail.map((event, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs p-2 rounded-sm hover:bg-muted/50 transition-colors">
                              <div className="flex flex-col gap-0.5">
                                <div className="font-bold font-mono text-primary">{event.symbol}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {event.openDate} ➔ {event.closeDate}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-0.5">
                                <div className={cn("font-bold font-mono", getPnLColor(event.pnl))}>
                                  {formatCurrency(event.pnl)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {event.qty}股 @ {event.openPrice} ➔ {event.closePrice}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <div className="p-2 border-t bg-muted/10 text-[10px] text-center text-muted-foreground">
                        共 {summary.m4_auditTrail.length} 笔交易
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <div
                className={cn(
                  "text-2xl font-bold font-mono tracking-tight mb-2",
                  metric.isPnl ? getPnLColor(metric.value) : "text-foreground"
                )}
              >
                {metric.formattedValue}
              </div>
            )
          ) : null}

          {/* Render Sub Items if present */}
          {metric.subItems && (
            <div className={cn(
              "grid grid-cols-2 gap-4 pt-1",
              (metric.formattedValue && metric.value !== undefined) && "border-t border-border/50 mt-1"
            )}>
              {metric.subItems.map((subItem) => (
                <div key={subItem.label} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-bold">
                    {subItem.label}
                  </div>
                  <div
                    className={cn(
                      "text-lg font-bold font-mono tracking-tight",
                      getPnLColor(subItem.value)
                    )}
                  >
                    {subItem.formattedValue}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Row 1: 4 items */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {row1Metrics.map((metric, i) => renderMetricCard(metric, i))}
      </div>

      {/* Row 2: 3 items, centered */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:w-3/4 lg:mx-auto">
        {row2Metrics.map((metric, i) => renderMetricCard(metric, i + 4))}
      </div>

      {/* Row 3: 3 items, centered */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:w-3/4 lg:mx-auto">
        {row3Metrics.map((metric, i) => renderMetricCard(metric, i + 7))}
      </div>
    </div>
  );
}