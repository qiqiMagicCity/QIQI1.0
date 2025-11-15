"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHoldings } from "@/hooks/use-holdings";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

export function NetCashInvested() {
  const { summary, loading } = useHoldings();

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-5 w-5" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-3/5" />
        </CardContent>
      </Card>
    );
  }

  const value = summary.totalCost;

  return (
    <Card className="transition-all hover:shadow-lg hover:-translate-y-1 bg-background">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          净现金投入 (NCI)
        </CardTitle>
        <DollarSign className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold")}>
          {value != null ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
      </CardContent>
    </Card>
  );
}
