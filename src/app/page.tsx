"use client";

import { Leaf } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalculationGrid } from "@/components/dashboard/calculation-grid";
import { HoldingsList } from "@/components/dashboard/holdings-list";
import { StockDetails } from "@/components/dashboard/stock-details";
import { TransactionHistory } from "@/components/dashboard/transaction-history";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { coreMetrics } from "@/lib/data";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";


const portfolioStatus: Status = 'live'; 

export default function Home() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-secondary">
      <DashboardHeader />
      <main className="flex flex-1 flex-col ">
        <div className="p-4 md:p-6 border-b border-border bg-background">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 flex items-center justify-center bg-primary rounded-lg text-primary-foreground shadow-md">
              <Leaf className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">绿トレーダー</h1>
          </div>

          <Tabs defaultValue="home">
            <TabsList className="grid w-full grid-cols-3 max-w-md">
              <TabsTrigger value="home">首页</TabsTrigger>
              <TabsTrigger value="details">股票详情</TabsTrigger>
              <TabsTrigger value="history">交易历史</TabsTrigger>
            </TabsList>
            <TabsContent value="home" className="mt-6">
              <div className="app-surface space-y-4">
                <section className="card p-4 md:p-6 flex items-start justify-between">
                  <div>
                    <h1 className="text-xl md:text-2xl font-semibold">首页</h1>
                    <p className="text-sm text-muted-foreground mt-1">组合概览与关键指标</p>
                  </div>
                  <StatusBadge status={portfolioStatus} />
                </section>

                <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {coreMetrics.map((metric) => (
                     <Card key={metric.id}>
                        <CardHeader className="pb-4">
                            <div className="flex items-start justify-between">
                                <span className="metric-title">{metric.title}</span>
                                <StatusBadge status={metric.status as Status} />
                            </div>
                        </CardHeader>
                        <CardContent>
                           <div className="metric-value">{metric.value}</div>
                            {metric.change && (
                                <p className={cn("text-xs mt-2", metric.changeType === 'positive' ? 'text-emerald-500' : 'text-destructive')}>
                                <span className="font-semibold">{metric.change}</span>
                                </p>
                            )}
                        </CardContent>
                    </Card>
                  ))}
                </section>

                <section className="card p-4 md:p-6">
                  <h2 className="text-base font-medium mb-3">分析仪表盘</h2>
                  <CalculationGrid />
                </section>

                <section className="card p-0 overflow-hidden">
                    <div className="flex items-center justify-between px-4 pt-4 pb-0">
                        <h2 className="text-base font-medium">持仓列表</h2>
                    </div>
                    <div className="p-4">
                        <HoldingsList />
                    </div>
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
    </div>
  );
}
