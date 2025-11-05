'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useMemo } from 'react';
import { useUser } from '@/firebase';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { buildHoldingsSnapshot, type Snapshot } from '@/lib/holdings/fifo';

export function HoldingsOverview() {
  const { user } = useUser();
  const { data: transactions, loading, error } = useUserTransactions(user?.uid);

  const snapshot: Snapshot = useMemo(() => {
    const list = Array.isArray(transactions) ? transactions : [];
    return buildHoldingsSnapshot(list);
  }, [transactions]);

  return (
    <section id="holdings" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle>持仓概览</CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <div className="min-w-[880px] sm:min-w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">代码</TableHead>
                    <TableHead>最后交易日</TableHead>
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
                    <TableRow><TableCell colSpan={9} className="h-24 text-center">加载中…</TableCell></TableRow>
                  )}
                  {error && !loading && (
                    <TableRow><TableCell colSpan={9} className="h-24 text-center text-destructive">加载失败：{error.message}</TableCell></TableRow>
                  )}
                  {!loading && !error && snapshot.holdings.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="h-24 text-center">无持仓（请先录入交易）</TableCell></TableRow>
                  )}
                  {!loading && !error && snapshot.holdings.map((h, idx) => (
                    <TableRow key={`${h.symbol}-${h.side}-${idx}`}>
                      <TableCell className="font-mono">{h.symbol}</TableCell>
                      {/* 注意：lastTxNy 已是 NY 日字符串，禁止任何再格式化 */}
                      <TableCell className="font-mono">{h.lastTxNy}</TableCell>
                      <TableCell>
                        <Badge className={h.side === 'LONG' ? 'bg-ok text-white border-none' : 'bg-destructive text-white border-none'}>
                          {h.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {h.netQty}{h.multiplier !== 1 ? <span className="text-muted-foreground"> × {h.multiplier}</span> : null}
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
