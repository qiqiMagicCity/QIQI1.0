"use client";

import dynamic from "next/dynamic";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalculationGrid } from "@/components/dashboard/calculation-grid";
import { HoldingsOverview } from "@/components/dashboard/holdings-overview";
import { StockDetails } from "@/components/dashboard/stock-details";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { useRequireAuth } from "@/components/auth/guards";
import { Skeleton } from "@/components/ui/skeleton";

const TransactionHistory = dynamic(
  () => import('@/components/dashboard/transaction-history').then(mod => mod.TransactionHistory),
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
  }
);

const portfolioStatus: Status = 'close'; 

export default function Home() {
  const { ready } = useRequireAuth();
  
  if (!ready) {
    // 可以在这里返回一个加载中的骨架屏，但守卫会自动处理重定向
    // 返回 null 或一个简单的加载指示器即可
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">正在验证身份...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <DashboardHeader />
      <main className="flex flex-1 flex-col ">
        <div className="p-4 md:p-6 border-b border-border/20 bg-transparent">
          
          <Tabs defaultValue="home">
            <TabsList>
              <TabsTrigger value="home">首页</TabsTrigger>
              <TabsTrigger value="details">股票详情</TabsTrigger>
              <TabsTrigger value="history">交易历史</TabsTrigger>
            </TabsList>
            <TabsContent value="home" className="mt-6">
              <div className="app-surface space-y-6">
                <section className="card p-4 md:p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h1 className="text-xl md:text-2xl font-semibold">首页</h1>
                      <p className="text-sm text-muted-foreground mt-1">组合概览与关键指标</p>
                    </div>
                    <StatusBadge status={portfolioStatus} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-background/50">
                      <CardHeader className="pb-4">
                        <div className="flex items-start justify-between">
                          <span className="metric-title">总资产</span>
                          <StatusBadge status={'close'} />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="metric-value">--</div>
                        <p className="text-xs mt-2 text-muted-foreground">
                          --
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-background/50">
                      <CardHeader className="pb-4">
                        <div className="flex items-start justify-between">
                          <span className="metric-title">持仓成本</span>
                          <StatusBadge status={'close'} />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="metric-value">--</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-background/50">
                      <CardHeader className="pb-4">
                        <div className="flex items-start justify-between">
                          <span className="metric-title">持仓浮盈</span>
                          <StatusBadge status={'close'} />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="metric-value">--</div>
                        <p className="text-xs mt-2 text-muted-foreground">
                          --
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </section>

                <section className="card p-4 md:p-6">
                  <h2 className="text-base font-medium mb-3">分析仪表盘</h2>
                  <CalculationGrid />
                </section>

                <HoldingsOverview />

              </div>
            </TabsContent>
            <TabsContent value="details" className="mt-6">
                <StockDetails />
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
