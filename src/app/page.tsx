"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalculationGrid } from "@/components/dashboard/calculation-grid";
import { HoldingsList } from "@/components/dashboard/holdings-list";
import { StockDetails } from "@/components/dashboard/stock-details";
import { TransactionHistory } from "@/components/dashboard/transaction-history";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AddTransactionForm } from "@/components/dashboard/add-transaction-form";
import { Button } from "@/components/ui/button";
import { useRequireAuth } from "@/components/auth/guards";


const portfolioStatus: Status = 'close'; 

export default function Home() {
  const { ready } = useRequireAuth();
  const [isFormOpen, setIsFormOpen] = useState(false);

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

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogTrigger asChild>
          <Button className="fixed bottom-8 right-8 h-16 w-16 rounded-full shadow-lg" size="icon">
            <Plus className="h-8 w-8" />
            <span className="sr-only">添加交易</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加一笔新交易</DialogTitle>
            <DialogDescription>
              请填写以下信息以记录您的新交易。
            </DialogDescription>
          </DialogHeader>
          <AddTransactionForm onSuccess={() => setIsFormOpen(false)} />
        </DialogContent>
      </Dialog>

    </div>
  );
}
