*   **纽约**: 2024-07-30 00:03:01 (America/New_York)
*   **UTC**: 2024-07-30 04:03:01 (UTC)

---

#### **1. 修改文件： `/src/components/dashboard/holdings-overview.tsx`**

*   **修改前**:
    ```tsx
    'use client';

    import {
      Table,
      TableBody,
      TableCell,
      TableHead,
      TableHeader,
      TableRow,
    } from '@/components/ui/table';
    import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
    import { Button } from '@/components/ui/button';
    import { Badge } from '@/components/ui/badge';
    import { Skeleton } from '@/components/ui/skeleton';
    import { useUser } from '@/firebase';
    import { useUserTransactions } from '@/hooks/use-user-transactions';
    import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
    import { useMemo } from 'react';
    import { cn } from '@/lib/utils';
    import Link from 'next/link';
    import { PlusCircle } from 'lucide-react';

    export function HoldingsOverview() {
      const { user } = useUser();
      const { data: transactions, loading: isLoadingTransactions } = useUserTransactions(user?.uid);

      const snapshot = useMemo(() => {
        if (!transactions) {
          return { holdings: [], audit: {} };
        }
        return buildHoldingsSnapshot(transactions);
      }, [transactions]);

      if (isLoadingTransactions) {
        return (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            </CardContent>
          </Card>
        );
      }

      return (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>持仓概览</CardTitle>
            <Link href="/transactions/editor" passHref>
              <Button asChild variant="outline" size="sm" className="gap-1">
                <a>
                  <PlusCircle className="h-4 w-4" />
                  新增交易
                </a>
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>代码</TableHead>
                    <TableHead className="hidden sm:table-cell">最后交易日(NY)</TableHead>
                    <TableHead>方向</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">成本单价</TableHead>
                    <TableHead className="text-right hidden md:table-cell">持仓成本</TableHead>
                    <TableHead className="text-right">现价</TableHead>
                    <TableHead className="text-right">浮动盈亏</TableHead>
                    <TableHead className="hidden sm:table-cell">状态</TableHead>
                    <TableHead className="text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.holdings.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="h-24 text-center text-muted-foreground"
                      >
                        无持仓（请先录入交易）
                      </TableCell>
                    </TableRow>
                  ) : (
                    snapshot.holdings.map((h) => (
                      <TableRow key={h.symbol}>
                        <TableCell className="font-mono">{h.symbol}</TableCell>
                        <TableCell className="hidden sm:table-cell font-mono text-xs">{h.lastTxNy}</TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              'border-none w-12 flex justify-center',
                              h.side === 'LONG'
                                ? 'bg-ok text-white'
                                : 'bg-destructive text-white'
                            )}
                          >
                            {h.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {h.netQty}
                          {h.multiplier !== 1 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              x{h.multiplier}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden sm:table-cell">
                          {h.costPerUnit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">
                          {h.costBasis.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono">{h.nowPrice ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono">{h.plFloating}</TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">{h.status}</TableCell>
                        <TableCell className="text-center">
                            <Link href={`/transactions/editor?symbol=${'\'\'\''}encodeURIComponent(h.symbol)'\'\''`} passHref>
                                <Button asChild variant="outline" size="sm">
                                    <a>进入编辑器</a>
                                </Button>
                            </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );
    }
    ```

*   **修改后 (新文件内容)**:
    ```tsx
    'use client';

    import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
    import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import Link from 'next/link';
    import { PlusCircle } from 'lucide-react';
    import { useMemo } from 'react';
    import { useUser } from '@/firebase';
    import { useUserTransactions } from '@/hooks/use-user-transactions';
    import { buildHoldingsSnapshot, type Snapshot } from '@/lib/holdings/fifo';

    export function HoldingsOverview() {
      const { user } = useUser();
      const { data: transactions, loading, error } = useUserTransactions(user?.uid);

      const snapshot: Snapshot = useMemo(() => {
        if (!transactions || !Array.isArray(transactions)) {
          return { holdings: [], audit: { txRead: 0, txUsed: 0, positionsProduced: 0, positionsZeroNetDropped: 0, anomalyCount: 0 } };
        }
        return buildHoldingsSnapshot(transactions);
      }, [transactions]);

      return (
        <section id="holdings" className="scroll-mt-20">
          <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>持仓概览</CardTitle>
              </div>
              <Link href="/transactions/editor" passHref>
                <Button asChild size="sm" className="h-8 gap-1">
                  <a>
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">新增交易</span>
                  </a>
                </Button>
              </Link>
            </CardHeader>

            <CardContent className="p-0">
              <div className="w-full overflow-x-auto">
                <div className="min-w-[880px] sm:min-w-full">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">代码</TableHead>
                        <TableHead>最后交易日 (NY)</TableHead>
                        <TableHead>方向</TableHead>
                        <TableHead className="text-right">数量</TableHead>
                        <TableHead className="text-right">成本单价</TableHead>
                        <TableHead className="text-right">持仓成本</TableHead>
                        <TableHead className="text-right">现价</TableHead>
                        <TableHead className="text-right">浮动盈亏</TableHead>
                        <TableHead className="text-right">状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading && (
                        <TableRow>
                          <TableCell colSpan={9} className="h-24 text-center">加载中…</TableCell>
                        </TableRow>
                      )}

                      {error && !loading && (
                        <TableRow>
                          <TableCell colSpan={9} className="h-24 text-center text-destructive">
                            加载失败：{error.message}
                          </TableCell>
                        </TableRow>
                      )}

                      {!loading && !error && snapshot.holdings.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="h-24 text-center">
                            无持仓（请先录入交易）
                          </TableCell>
                        </TableRow>
                      )}

                      {!loading && !error && snapshot.holdings.map(h => (
                        <TableRow key={`${'\'\'\''}h.symbol`-'\'\''}${h.side}`}>
                          <TableCell className="font-mono">{h.symbol}</TableCell>
                          {/* 按规则：lastTxNy 已是字符串，不做任何本地化与再格式化 */}
                          <TableCell className="font-mono">{h.lastTxNy}</TableCell>
                          <TableCell>
                            <Badge className={h.side === 'LONG' ? 'bg-ok text-white border-none' : 'bg-destructive text-white border-none'}>
                              {h.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {h.netQty}
                            {h.multiplier !== 1 ? <span className="text-muted-foreground"> × {h.multiplier}</span> : null}
                          </TableCell>
                          <TableCell className="text-right font-mono">{h.costPerUnit.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(h.costBasis).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right font-mono">—</TableCell>
                          <TableCell className="text-right font-mono">--</TableCell>
                          <TableCell className="text-right font-mono">calc_pending</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      );
    }
    ```

---

#### **2. 修改文件： `/src/app/page.tsx`**

*   **修改前**:
    ```tsx
    "use client";

    import { useState } from "react";
    import dynamic from "next/dynamic";
    import { Plus } from "lucide-react";
    import Link from 'next/link';
    import { DashboardHeader } from "@/components/dashboard/dashboard-header";
    import { CalculationGrid } from "@/components/dashboard/calculation-grid";
    import { HoldingsOverview } from "@/components/dashboard/holdings-overview";
    import { StockDetails } from "@/components/dashboard/stock-details";
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
    import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
    import { StatusBadge, type Status } from "@/components/ui/status-badge";
    import { Button } from "@/components/ui/button";
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

                    <section>
                      <HoldingsOverview />
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

          <Link href="/transactions/editor" passHref>
            <Button asChild className="fixed bottom-8 right-8 h-16 w-16 rounded-full shadow-lg" size="icon">
              <a>
                <Plus className="h-8 w-8" />
                <span className="sr-only">添加交易</span>
              </a>
            </Button>
          </Link>
        </div>
      );
    }
    ```

*   **修改后 (新文件内容)**:
    ```tsx
    "use client";

    import { useState } from "react";
    import dynamic from "next/dynamic";
    import { Plus } from "lucide-react";
    import Link from 'next/link';
    import { DashboardHeader } from "@/components/dashboard/dashboard-header";
    import { CalculationGrid } from "@/components/dashboard/calculation-grid";
    import { HoldingsOverview } from "@/components/dashboard/holdings-overview";
    import { StockDetails } from "@/components/dashboard/stock-details";
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
    import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
    import { StatusBadge, type Status } from "@/components/ui/status-badge";
    import { Button } from "@/components/ui/button";
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

          <Link href="/transactions/editor" passHref>
            <Button asChild className="fixed bottom-8 right-8 h-16 w-16 rounded-full shadow-lg" size="icon">
              <a>
                <Plus className="h-8 w-8" />
                <span className="sr-only">添加交易</span>
              </a>
            </Button>
          </Link>
        </div>
      );
    }
    ```