'use client';

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
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
import { useHoldings, type HoldingRow } from "@/hooks/use-holdings";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

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

function HoldingsTable() {
  const { rows, loading } = useHoldings();

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>持仓列表</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代码</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">当日盈亏</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((holding) => {
              const hasTodayPlNumber =
                typeof holding.todayPl === 'number' && Number.isFinite(holding.todayPl);

              return (
                <TableRow key={holding.symbol}>
                  <TableCell className="font-medium">{holding.symbol}</TableCell>
                  <TableCell className="text-right">{holding.netQty}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {hasTodayPlNumber ? (
                        <span
                          className={cn(
                            holding.todayPl! > 0
                              ? 'text-success'
                              : holding.todayPl! < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          )}
                        >
                          {holding.todayPl!.toFixed(2)}
                        </span>
                      ) : (
                        <span>—</span>
                      )}

                      {holding.todayPlStatus != null && (
                        <StatusBadge status={holding.todayPlStatus} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const portfolioStatus: Status = 'closed';

export default function Home() {
  const { ready } = useRequireAuth();

  if (!ready) {
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
                          <StatusBadge status={'closed'} />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="metric-value">--</div>
                        <p className="text-xs mt-2 text-muted-foreground">--</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-background/50">
                      <CardHeader className="pb-4">
                        <div className="flex items-start justify-between">
                          <span className="metric-title">持仓成本</span>
                          <StatusBadge status={'closed'} />
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
                          <StatusBadge status={'closed'} />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="metric-value">--</div>
                        <p className="text-xs mt-2 text-muted-foreground">--</p>
                      </CardContent>
                    </Card>
                  </div>
                </section>

                <section className="card p-4 md:p-6">
                  <h2 className="text-base font-medium mb-3">分析仪表盘</h2>
                  <CalculationGrid />
                </section>

                <section>
                  <HoldingsTable />
                </section>
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

      <Button
        asChild
        className="fixed bottom-8 right-8 h-16 w-16 rounded-full shadow-lg"
        size="icon"
      >
        <Link href="/transactions/editor">
          <Plus className="h-8 w-8" />
          <span className="sr-only">添加交易</span>
        </Link>
      </Button>
    </div>
  );
}
