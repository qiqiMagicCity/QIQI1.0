import { Leaf } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalculationGrid } from "@/components/dashboard/calculation-grid";
import { HoldingsList } from "@/components/dashboard/holdings-list";
import { StockDetails } from "@/components/dashboard/stock-details";
import { TransactionHistory } from "@/components/dashboard/transaction-history";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <DashboardHeader />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 lg:p-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-primary rounded-lg text-primary-foreground shadow-md">
            <Leaf className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">绿トレーダー</h1>
        </div>

        <Tabs defaultValue="holdings">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="holdings">首页</TabsTrigger>
            <TabsTrigger value="details">股票详情</TabsTrigger>
            <TabsTrigger value="history">交易历史</TabsTrigger>
          </TabsList>
          <TabsContent value="holdings">
            <div className="grid gap-8 mt-6">
              <CalculationGrid />
              <HoldingsList />
            </div>
          </TabsContent>
          <TabsContent value="details">
            <div className="mt-6">
              <StockDetails />
            </div>
          </TabsContent>
          <TabsContent value="history">
            <div className="mt-6">
              <TransactionHistory />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
