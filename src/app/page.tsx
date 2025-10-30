import { Leaf } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalculationGrid } from "@/components/dashboard/calculation-grid";
import { HoldingsList } from "@/components/dashboard/holdings-list";
import { StockDetails } from "@/components/dashboard/stock-details";
import { TransactionHistory } from "@/components/dashboard/transaction-history";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <DashboardHeader />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-primary rounded-lg text-primary-foreground">
            <Leaf className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-semibold">绿トレーダー</h1>
        </div>

        <Tabs defaultValue="holdings">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="holdings">首页</TabsTrigger>
            <TabsTrigger value="details">股票详情</TabsTrigger>
            <TabsTrigger value="history">交易历史</TabsTrigger>
          </TabsList>
          <TabsContent value="holdings">
            <div className="grid gap-8">
              <CalculationGrid />
              <HoldingsList />
            </div>
          </TabsContent>
          <TabsContent value="details">
            <StockDetails />
          </TabsContent>
          <TabsContent value="history">
            <TransactionHistory />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
