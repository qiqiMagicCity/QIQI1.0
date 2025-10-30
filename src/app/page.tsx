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
              <div className="app-surface space-y-4">
                <section className="card p-4 md:p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h1 className="text-xl md:text-2xl font-semibold">首页</h1>
                      <p className="text-sm text-muted-foreground mt-1">组合概览与关键指标</p>
                    </div>
                    <StatusBadge status={portfolioStatus} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {coreMetrics.map((metric) => (
                      <Card key={metric.id} className="bg-background/50">
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
                  </div>
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
