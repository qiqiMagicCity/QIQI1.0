'use client';

import { useHoldings } from '@/hooks/use-holdings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SymbolName } from '@/components/dashboard/symbol-name';
import { AssetTypeIcon } from '@/components/common/asset-type-icon';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type Status as UiStatus } from '@/components/ui/status-badge';

const formatCurrency = (value: number | null | undefined) => {
  if (value == null || typeof value !== 'number') return '—';
  const sign = value > 0 ? '+' : '';
  return sign + value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatCurrencyNoSign = (value: number | null | undefined) => {
  if (value == null || typeof value !== 'number') return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatPercent = (value: number | null | undefined) => {
  if (value == null || typeof value !== 'number') return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
};

// 显示“当日盈亏”数字的唯一条件：拿到了有效数值
const showRowTodayPlNumber = (row: { todayPl: number | null | undefined }) =>
  typeof row.todayPl === 'number' && Number.isFinite(row.todayPl);

// 将实时价格状态（live/stale/closed/pending/error）映射到 UI 徽章状态
function mapRtStatusToUiStatus(status: string | null | undefined): UiStatus {
  switch (status) {
    case 'live':
      return 'live'; // 盘中，闪烁
    case 'pending':
      return 'ready'; // 刚发起拉价/等待返回，可视为“就绪中”
    case 'closed':
      return 'closed'; // 已收盘
    case 'stale':
      return 'stale'; // 待更新（停止更新或超过新鲜度阈值）
    case 'error':
      return 'degraded'; // 数据降级
    default:
      return 'stale';
  }
}

// 注意：这里先定义函数，最后统一做默认导出 + 具名导出
function HoldingsOverview() {
  const { rows, loading } = useHoldings();

  return (
    <section id="holdings" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle className="text-base md:text-lg">持仓概览</CardTitle>
        </CardHeader>
        {/* 整个表格默认字体稍微放大：移动端 13px，桌面端 text-sm */}
        <CardContent className="p-0 text-[13px] md:text-sm">
          <div className="w-full overflow-x-auto">
            <div className="min-w-[1280px] sm:min-w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs md:text-sm">logo</TableHead>
                    <TableHead className="text-xs md:text-sm">代码</TableHead>
                    <TableHead className="text-xs md:text-sm">中文名</TableHead>
                    <TableHead className="text-xs md:text-sm">类型</TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      实时价格
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      目前持仓数量
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      持仓单价
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      净现金投入（Net Cash Invested，NCI)
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      盈亏平衡点
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      当日盈亏
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      当日变动
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      当日变动%
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      持仓盈亏
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      历史交易次数
                    </TableHead>
                    <TableHead className="text-right text-xs md:text-sm">
                      详情
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={15} className="h-24 text-center">
                        加载中…
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={15} className="h-24 text-center">
                        无持仓（请先录入交易）
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading &&
                    rows.map((row) => {
                      const costBasis =
                        row.avgCost != null
                          ? Math.abs(row.netQty) * (row.multiplier ?? 1) * row.avgCost
                          : null;

                      return (
                        <TableRow
                          key={`${row.symbol}-${row.assetType}-${row.multiplier ?? 1}`}
                        >
                          <TableCell className="text-[13px] md:text-sm">
                            <span className="text-yellow-500">建设中 ing</span>
                          </TableCell>
                          <TableCell className="font-mono font-medium text-sm md:text-base">
                            {row.symbol}
                          </TableCell>
                          <TableCell className="text-sm md:text-base">
                            <SymbolName symbol={row.symbol} />
                          </TableCell>
                          <TableCell className="text-sm md:text-base">
                            <Badge
                              className={`border-none gap-1 ${
                                row.assetType === 'option'
                                  ? 'bg-orange-600 text-white'
                                  : 'bg-slate-700 text-white'
                              }`}
                            >
                              <AssetTypeIcon
                                assetType={row.assetType as any}
                                className="h-4 w-4"
                              />
                              <span>{row.assetType === 'option' ? '期权' : '股票'}</span>
                            </Badge>
                          </TableCell>
                          {/* 实时价格 + 实时价格状态徽章（来自价格中心） */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            <div className="flex items-center justify-end gap-2">
                              <span>{formatCurrencyNoSign(row.last)}</span>
                              {row.priceStatus && (
                                <StatusBadge
                                  status={mapRtStatusToUiStatus(row.priceStatus)}
                                  className="inline-flex items-center shrink-0 rounded-full px-2 text-[11px] h-5"
                                />
                              )}
                            </div>
                          </TableCell>
                          {/* 持仓数量 */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            {row.netQty}
                            {row.assetType === 'option' && (
                              <span className="text-muted-foreground text-xs ml-1">
                                ×{row.multiplier}
                              </span>
                            )}
                          </TableCell>
                          {/* 持仓单价 */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            {row.avgCost !== null ? row.avgCost.toFixed(4) : '—'}
                          </TableCell>
                          {/* 净现金投入（NCI） */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            {formatCurrencyNoSign(costBasis)}
                          </TableCell>
                          {/* 盈亏平衡点（建设中） */}
                          <TableCell className="text-right text-sm md:text-base">
                            <span className="text-yellow-500">建设中 ing</span>
                          </TableCell>
                          {/* 当日盈亏：只显示数字，不再叠加状态徽章 */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            <div className="flex items-center justify-end gap-2">
                              <span>
                                {showRowTodayPlNumber(row)
                                  ? formatCurrency(row.todayPl)
                                  : '—'}
                              </span>
                            </div>
                          </TableCell>
                          {/* 当日变动（建设中） */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            <span>{formatCurrency(row.dayChange)}</span>
                          </TableCell>
                          {/* 当日变动%（建设中） */}
                          <TableCell className="text-right font-mono text-sm md:text-base">
                            <span>{formatPercent(row.dayChangePct)}</span>
                          </TableCell>
                          {/* 持仓盈亏（建设中） */}
                          <TableCell className="text-right text-sm md:text-base">
                            <span className="text-yellow-500">建设中 ing</span>
                          </TableCell>
                          {/* 历史交易次数（建设中） */}
                          <TableCell className="text-right text-sm md:text-base">
                            <span className="text-yellow-500">建设中 ing</span>
                          </TableCell>
                          {/* 详情按钮 */}
                          <TableCell className="text-right text-sm md:text-base">
                            <Button variant="ghost" size="sm">
                              详情
                            </Button>
                          </TableCell>
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

// 这里显式同时导出：默认导出 + 具名导出
export default HoldingsOverview;
export { HoldingsOverview };