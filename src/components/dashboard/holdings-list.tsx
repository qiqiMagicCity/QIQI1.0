import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { holdings } from "@/lib/data";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

export function HoldingsList() {
  return (
    <section id="holdings" className="scroll-mt-20">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">持仓列表</CardTitle>
          <CardDescription>您当前的股票头寸概览。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">股票</TableHead>
                <TableHead className="text-right font-semibold">价值</TableHead>
                <TableHead className="text-right font-semibold">盈亏 %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.map((holding) => (
                <TableRow key={holding.symbol} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="font-bold text-base">{holding.symbol}</div>
                    <div className="text-sm text-muted-foreground">{holding.name}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium text-base">${holding.currentValue.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">{holding.shares} 股</div>
                  </TableCell>
                  <TableCell className={cn("text-right font-bold text-base flex justify-end items-center gap-1", holding.plPercent >= 0 ? "text-emerald-400" : "text-destructive")}>
                    {holding.plPercent >= 0 ? <ArrowUp className="h-4 w-4"/> : <ArrowDown className="h-4 w-4"/>}
                    {holding.plPercent.toFixed(2)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
