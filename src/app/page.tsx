"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalculationGrid } from "@/components/dashboard/calculation-grid";
import { HoldingsOverview } from "@/components/dashboard/holdings-overview";
import { StockDetails } from "@/components/dashboard/stock-details";
import { StocksTab } from "@/components/dashboard/stocks-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SystemStatus } from "@/components/debug/system-status";
import { useRequireAuth } from "@/components/auth/guards";
import { Skeleton } from "@/components/ui/skeleton";
import { useHoldings } from "@/hooks/use-holdings";
import { useUser } from "@/firebase";
import { DollarSign, Wallet, TrendingUp } from "lucide-react";
import { ForceVisibleStatus } from "@/components/debug/force-status";
import { BUILD_ID, BUILD_TIME, EOD_RULE_REV } from "@/lib/build-info";
import { Loader2 } from "lucide-react";

const TransactionHistory = dynamic(
  () =>
    import("@/components/dashboard/transaction-history").then(
      (mod) => mod.TransactionHistory,
    ),
  {
    ssr: false,
    loading: () => (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    ),
  },
);

// 金额格式化（Currency 货币格式）
function formatCurrency(value: number | null | undefined): string {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// 带正负号的格式化（用于盈亏 P&L）
function formatSigned(value: number | null | undefined): string {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2);
}

export default function Home() {
  const { ready } = useRequireAuth();
  const { user, isUserLoading, authTimeout } = useUser();
  const { summary, loading, isLiveMode } = useHoldings();

  // [NEW] Build Info Log
  useEffect(() => {
    console.info('[BUILD]', { BUILD_ID, BUILD_TIME, EOD_RULE_REV });
  }, []);

  if (!ready) {
    const isStuck = !isUserLoading && !user;
    const showInteractiveOptions = authTimeout || isStuck;

    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-6 p-4 bg-background">
        <div className="flex flex-col items-center space-y-4">
          {isUserLoading ? (
            <div className="relative">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              {authTimeout && (
                <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-500 border-2 border-background animate-pulse"></div>
              )}
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">!</div>
          )}

          <div className="text-center space-y-2">
            <p className="text-xl font-semibold tracking-tight">
              {isUserLoading ? (authTimeout ? '连接延迟中...' : '正在验证身份...') : '未检测到登录'}
            </p>
            <p className="text-sm text-muted-foreground max-w-[280px]">
              {isUserLoading
                ? (authTimeout ? '网络请求响应较慢，您可以继续等待或尝试手动重新登录。' : '正在安全连接至数据服务中心')
                : '检测到登录已失效，即将跳转至登录页面'}
            </p>
          </div>
        </div>

        {/* 交互式恢复选项 (Guardrail 2) */}
        <div className="flex flex-col items-center gap-4 w-full max-w-xs animate-in fade-in slide-in-from-bottom-4 duration-700">
          {showInteractiveOptions && (
            <div className="grid grid-cols-1 gap-3 w-full">
              <a
                href="/login"
                className="flex items-center justify-center px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium transition-all shadow-lg shadow-primary/20 active:scale-95"
              >
                {isUserLoading ? '尝试重新登录' : '前往登录'}
              </a>

              {isUserLoading && (
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center justify-center px-6 py-2.5 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-lg text-sm font-medium transition-all active:scale-95"
                >
                  刷新重试
                </button>
              )}
            </div>
          )}

          <div className="mt-4 p-3 bg-muted/50 rounded-md border border-border/50 w-full">
            <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground/60">
              <span>AUTH_STATUS</span>
              <span className={isUserLoading ? 'text-amber-500' : 'text-green-500'}>
                {isUserLoading ? (authTimeout ? 'SLOW' : 'PENDING') : 'READY'}
              </span>
            </div>
            <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground/60 mt-1">
              <span>SOURCE_TRUTH</span>
              <span>onAuthStateChanged</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const gmvDisplay = loading ? "--" : formatCurrency(summary.totalGrossMv);
  const nciDisplay = loading ? "--" : formatCurrency(summary.totalNci);
  const pnlDisplay = loading ? "--" : formatSigned(summary.totalPnl);

  return (
    <div className="flex min-h-screen w-full flex-col relative">
      {/* [NEW] Live Mode Banner */}
      {isLiveMode && (
        <div className="bg-amber-500 text-black py-1 px-4 text-center text-xs font-bold flex items-center justify-center gap-2 animate-pulse z-[100]">
          <Loader2 className="h-3 w-3 animate-spin" />
          LIVE MODE（实时模式）- 已绕开快照，直接执行全量计算
        </div>
      )}
      <DashboardHeader />
      <main className="flex flex-1 flex-col">
        <div className="p-4 md:p-6 border-b border-border/20 bg-transparent">
          <Tabs defaultValue="home">
            <TabsList>
              <TabsTrigger value="home">首页</TabsTrigger>
              <TabsTrigger value="details">交易分析</TabsTrigger>
              <TabsTrigger value="stocks">个股详情</TabsTrigger>
              <TabsTrigger value="history">交易历史</TabsTrigger>
            </TabsList>



            <TabsContent value="home" className="mt-6">
              <div className="app-surface space-y-6">
                {/* 首页大框 */}
                <section className="card p-4 md:p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h1 className="text-xl md:text-2xl font-semibold">首页</h1>
                      <p className="text-sm text-muted-foreground mt-1">
                        组合概览与关键指标
                      </p>
                    </div>
                    <SystemStatus />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {/* 1）总持仓市值 GMV */}
                    <Card className="transition-all hover:shadow-lg hover:-translate-y-1 bg-background/100">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-bold">
                            总持仓市值（Gross Market Value，GMV）
                          </CardTitle>
                        </div>
                        <StatusBadge status={summary?.gmvStatus ?? "degraded"} />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <DollarSign className="h-5 w-5 text-muted-foreground" />
                          <div className="text-3xl font-bold text-emerald-600">
                            {gmvDisplay}
                          </div>
                        </div>
                        <p className="text-xs mt-2 text-muted-foreground">
                          绝对值口径：多空持仓一律按 |数量| × 实时价格 × 合约乘数 汇总。
                        </p>
                      </CardContent>
                    </Card>

                    {/* 2）净现金投入 NCI */}
                    <Card className="transition-all hover:shadow-lg hover:-translate-y-1 bg-background/100">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-base font-bold">
                          净现金投入（Net Cash Invested，NCI）
                        </CardTitle>
                        <StatusBadge status={summary?.nciStatus ?? "degraded"} />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <Wallet className="h-5 w-5 text-muted-foreground" />
                          <div className="text-3xl font-bold text-emerald-600">
                            {nciDisplay}
                          </div>
                        </div>
                        <p className="text-xs mt-2 text-muted-foreground">
                          绝对值口径：|数量| × 成本价格 × 合约乘数，用于刻画当前持仓对应的本金规模。
                        </p>
                      </CardContent>
                    </Card>

                    {/* 3）按市价计价利润（Mark-to-Market Profit）（总 P&L） */}
                    <Card className="transition-all hover:shadow-lg hover:-translate-y-1 bg-background/100">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-base font-bold">
                          按市价计价利润（Mark-to-Market Profit）
                        </CardTitle>
                        <StatusBadge status={summary?.pnlStatus ?? "degraded"} />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <TrendingUp className="h-5 w-5 text-muted-foreground" />
                          <div className="text-3xl font-bold text-emerald-600">
                            {pnlDisplay}
                          </div>
                        </div>
                        <p className="text-xs mt-2 text-muted-foreground">
                          基于实时价格（Real-time Price）计算的总持仓浮动盈亏，仅用于展示，不做托底。
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </section>

                {/* 分析仪表盘 */}
                <section className="card p-4 md:p-6">
                  <h2 className="text-base font-medium mb-3">分析仪表盘</h2>
                  <CalculationGrid />
                </section>

                {/* 持仓概览表 */}
                <HoldingsOverview />
              </div>
            </TabsContent>

            <TabsContent value="details" className="mt-6">
              <StockDetails />
            </TabsContent>

            <TabsContent value="stocks" className="mt-6">
              <StocksTab />
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <TransactionHistory />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* [NEW] Watermark */}
      <div className="fixed bottom-2 right-2 flex flex-col items-end gap-0.5 pointer-events-none z-[100] opacity-30 select-none">
        <div className="text-[10px] font-mono font-bold bg-zinc-900/50 px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/5 text-zinc-400">
          EOD_RULE={EOD_RULE_REV}
        </div>
        <div className="text-[8px] font-mono bg-zinc-900/50 px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/5 text-zinc-500">
          BUILD={BUILD_ID}
        </div>
      </div>
    </div>
  );
}