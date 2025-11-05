'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from "@/components/ui/button";
import { SymbolName } from "@/components/dashboard/symbol-name";
import { TransactionTypeIcon } from '@/components/common/transaction-type-icon';
import { Badge } from '@/components/ui/badge';

const formatCurrency = (value: number | null) => {
  if (value === null) return '—';
  // Format with sign for PnL
  const sign = value > 0 ? '+' : '';
  return sign + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCurrencyNoSign = (value: number | null) => {
  if (value === null) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPercent = (value: number | null) => {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
};

export function HoldingsOverview() {
  const { rows, loading } = useHoldings();

  return (
    <section id="holdings" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle>持仓概览</CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <div className="min-w-[1280px] sm:min-w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>logo</TableHead>
                    <TableHead>代码</TableHead>
                    <TableHead>中文名</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead className="text-right">实时价格</TableHead>
                    <TableHead className="text-right">目前持仓数量</TableHead>
                    <TableHead className="text-right">持仓单价</TableHead>
                    <TableHead className="text-right">持仓金额</TableHead>
                    <TableHead className="text-right">盈亏平衡点</TableHead>
                    <TableHead className="text-right">当日浮动盈亏</TableHead>
                    <TableHead className="text-right">浮动百分</TableHead>
                    <TableHead className="text-right">持仓盈亏</TableHead>
                    <TableHead className="text-right">历史交易次数</TableHead>
                    <TableHead className="text-right">详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={14} className="h-24 text-center">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!loading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={14} className="h-24 text-center">无持仓（请先录入交易）</TableCell>
                    </TableRow>
                  )}
                  {!loading && rows.map((row) => {
                    const costBasis = (row.avgCost != null) ? Math.abs(row.netQty) * (row.multiplier ?? 1) * row.avgCost : null;
                    return (
                      <TableRow key={`${row.symbol}-${row.assetType}-${row.multiplier ?? 1}`}>
                        <TableCell><span className="text-yellow-500">建设中 ing</span></TableCell>
                        <TableCell className="font-mono font-medium">{row.symbol}</TableCell>
                        <TableCell><SymbolName symbol={row.symbol} /></TableCell>
                        <TableCell>
                          <Badge className={`border-none gap-1 ${row.assetType === 'option' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-white'}`}>
                            <TransactionTypeIcon type={row.assetType} />
                            <span>{row.assetType === 'option' ? '期权' : '股票'}</span>
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">未接价格</TableCell>
                        <TableCell className="text-right font-mono">
                          {row.netQty}
                          {row.assetType === 'option' && <span className="text-muted-foreground text-xs ml-1">×{row.multiplier}</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{row.avgCost !== null ? row.avgCost.toFixed(4) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrencyNoSign(costBasis)}</TableCell>
                        <TableCell className="text-right"><span className="text-yellow-500">建设中 ing</span></TableCell>
                        <TableCell className="text-right"><span className="text-yellow-500">建设中 ing</span></TableCell>
                        <TableCell className="text-right font-mono"><span className="text-yellow-500">建设中 ing</span></TableCell>
                        <TableCell className="text-right font-mono"><span className="text-yellow-500">建设中 ing</span></TableCell>
                        <TableCell className="text-right"><span className="text-yellow-500">建设中 ing</span></TableCell>
                        <TableCell className="text-right"><Button variant="ghost" size="sm">详情</Button></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}