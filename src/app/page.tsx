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
  const { user, isUserLoading } = useUser();
  const { summary, loading } = useHoldings();

  // 增加超时显示登录按钮的机制
  const [showManualLogin, setShowManualLogin] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowManualLogin(true);
    }, 2000); // 2秒后如果还在加载，显示手动登录按钮
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    // Determine specific state for better UX
    const isStuck = !isUserLoading && !user; // Loaded but no user (and redirect hasn't happened yet)
    const showButton = showManualLogin || isStuck;

    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-6 p-4 bg-background">
        <div className="flex flex-col items-center space-y-4">
          {isUserLoading ? (
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          ) : (
            <div className="h-8 w-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">!</div>
          )}

          <div className="text-center space-y-1">
            <p className="text-lg font-medium">
              {isUserLoading ? '正在验证身份...' : '未检测到登录'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isUserLoading ? '正在连接安全服务' : '即将跳转至登录页面'}
            </p>
          </div>
        </div>

        {/* 调试/手动操作区域 */}
        <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {showButton && (
            <a
              href="/login"
              className="px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors shadow-lg shadow-primary/20"
            >
              {isUserLoading ? '等待太久？点此登录' : '前往登录'}
            </a>
          )}

          <div className="text-xs text-muted-foreground/40 font-mono text-center max-w-[200px]">
            <p>Status: {isUserLoading ? 'Verifying...' : 'Ready (No User)'}</p>
            <p>Redirecting: {isStuck ? 'Yes' : 'No'}</p>
          </div>
        </div>
      </div>
    );
  }

  const gmvDisplay = loading ? "--" : formatCurrency(summary.totalGrossMv);
  const nciDisplay = loading ? "--" : formatCurrency(summary.totalNci);
  const pnlDisplay = loading ? "--" : formatSigned(summary.totalPnl);

  return (
    <div className="flex min-h-screen w-full flex-col">
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
    </div>
  );
}