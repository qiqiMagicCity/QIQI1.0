'use client';
import { useState, useMemo } from 'react';
import { useHoldings } from '@/hooks/use-holdings';
import { usePriceCenterContext } from '@/price/RealTimePricesProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { SymbolName } from '@/components/dashboard/symbol-name';
import { AssetTypeIcon } from '@/components/common/asset-type-icon';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type Status as UiStatus } from '@/components/ui/status-badge';
import { CompanyLogo } from '@/components/common/company-logo';
import {
  ArrowUpDown,
  ChevronsUp,
  ChevronsDown,
  ArrowUpRight,
} from 'lucide-react';

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

// 根据当日盈亏数值返回颜色类名（正数绿色，负数红色，其他不着色）
const getTodayPlClassName = (value: number | null | undefined): string => {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (value > 0) return 'text-emerald-500';
  if (value < 0) return 'text-red-500';
  return '';
};

// 将实时价格状态（RtStatus，Real-time Status 实时价格状态）映射到 UI 徽章状态
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
  const { fetchingSymbol } = usePriceCenterContext();

  type SortKey = 'symbol' | 'assetType' | 'last' | 'netQty' | 'avgCost' | 'costBasis' | 'todayPl' | 'dayChange' | 'dayChangePct';
  type SortDirection = 'asc' | 'desc' | null;

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'costBasis',
    direction: 'desc',
  });

  const handleSort = (key: SortKey) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        // 同一列：null -> asc -> desc -> null
        const nextDirection: SortDirection =
          prev.direction === null ? 'asc' :
            prev.direction === 'asc' ? 'desc' : null;
        return { key, direction: nextDirection };
      } else {
        // 新列：默认升序
        return { key, direction: 'asc' };
      }
    });
  };

  const sortedRows = useMemo(() => {
    if (!sortConfig.direction) return rows;

    const sorted = [...rows].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      // 计算 costBasis
      const getCostBasis = (row: typeof rows[0]) => {
        return row.avgCost != null
          ? Math.abs(row.netQty) * (row.multiplier ?? 1) * row.avgCost
          : null;
      };

      switch (sortConfig.key) {
        case 'symbol':
          aVal = a.symbol;
          bVal = b.symbol;
          break;
        case 'assetType':
          aVal = a.assetType;
          bVal = b.assetType;
          break;
        case 'last':
          aVal = a.last;
          bVal = b.last;
          break;
        case 'netQty':
          aVal = a.netQty;
          bVal = b.netQty;
          break;
        case 'avgCost':
          aVal = a.avgCost;
          bVal = b.avgCost;
          break;
        case 'costBasis':
          aVal = getCostBasis(a);
          bVal = getCostBasis(b);
          break;
        case 'todayPl':
          aVal = a.todayPl;
          bVal = b.todayPl;
          break;
        case 'dayChange':
          aVal = a.dayChange;
          bVal = b.dayChange;
          break;
        case 'dayChangePct':
          aVal = a.dayChangePct;
          bVal = b.dayChangePct;
          break;
        default:
          return 0;
      }

      // 处理 null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1; // null 排后面
      if (bVal == null) return -1;

      // 比较
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      } else {
        return sortConfig.direction === 'asc'
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      }
    });

    return sorted;
  }, [rows, sortConfig]);

  const SortableHeader = ({
    sortKey,
    children,
    className = ''
  }: {
    sortKey: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => {
    const isActive = sortConfig.key === sortKey;
    const Icon = !isActive || sortConfig.direction === null
      ? ArrowUpDown
      : sortConfig.direction === 'asc'
        ? ChevronsUp
        : ChevronsDown;

    // 图标颜色：升序红色，降序绿色，未排序灰色
    const iconColor = isActive && sortConfig.direction === 'asc'
      ? 'text-red-500'
      : isActive && sortConfig.direction === 'desc'
        ? 'text-emerald-500'
        : 'text-muted-foreground';

    return (
      <TableHead className={className}>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-1 hover:bg-emerald-500/10 font-semibold transition-colors group"
          onClick={() => handleSort(sortKey)}
        >
          <span className="mr-1 group-hover:text-emerald-600 transition-colors">{children}</span>
          <Icon className={`h-3 w-3 ${iconColor} shrink-0`} />
        </Button>
      </TableHead>
    );
  };

  return (
    <section id="holdings" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle className="text-base md:text-lg">持仓概览</CardTitle>
        </CardHeader>

        {/* 整个表格默认字体稍微放大：移动端 13px，桌面端 text-sm */}
        <CardContent className="p-0 text-[13px] md:text-sm">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center px-2 w-[50px]">logo</TableHead>
                  <SortableHeader sortKey="symbol" className="px-2">代码</SortableHeader>
                  <TableHead className="px-2">中文名</TableHead>
                  <SortableHeader sortKey="assetType" className="px-2">类型</SortableHeader>
                  <SortableHeader sortKey="last" className="text-right px-2">
                    现价
                  </SortableHeader>
                  <SortableHeader sortKey="netQty" className="text-right px-2">
                    持仓
                  </SortableHeader>
                  <SortableHeader sortKey="avgCost" className="text-right px-2">
                    成本
                  </SortableHeader>
                  <SortableHeader sortKey="costBasis" className="text-right px-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dotted border-muted-foreground/50">NCI</span>
                        </TooltipTrigger>
                        <TooltipContent>净现金投入 (Net Cash Invested)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </SortableHeader>
                  <TableHead className="text-right px-2">
                    保本价
                  </TableHead>
                  <SortableHeader sortKey="todayPl" className="text-right px-2">
                    日盈亏
                  </SortableHeader>
                  <SortableHeader sortKey="dayChangePct" className="text-right px-2">
                    日变动
                  </SortableHeader>
                  <TableHead className="text-right px-2 text-muted-foreground">
                    持仓盈亏
                  </TableHead>
                  <TableHead className="text-right px-2 text-muted-foreground">
                    已实现
                  </TableHead>
                  <TableHead className="text-center px-2 text-muted-foreground w-[50px]">
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
                  sortedRows.map((row) => {
                    const costBasis =
                      row.avgCost != null
                        ? Math.abs(row.netQty) * (row.multiplier ?? 1) * row.avgCost
                        : null;

                    const isMissingEod =
                      row.todayPlStatus === 'missing-ref-eod' ||
                      row.todayPlStatus === 'missing-today-eod' ||
                      row.todayPlStatus === 'pending-eod-fetch';

                    const isMissingRealtime = row.todayPlStatus === 'degraded';

                    return (
                      <TableRow
                        key={`${row.symbol}-${row.assetType}-${row.multiplier ?? 1}`}
                      >
                        <TableCell className="text-[13px] md:text-sm text-center px-2">
                          <CompanyLogo symbol={row.symbol} size={24} className="mx-auto" />
                        </TableCell>

                        <TableCell className="font-mono font-bold text-base md:text-lg px-2">
                          {row.symbol}
                        </TableCell>

                        <TableCell className="text-sm md:text-base px-2">
                          <SymbolName symbol={row.symbol} />
                        </TableCell>

                        <TableCell className="text-sm md:text-base px-2">
                          <div className="flex flex-col gap-1">
                            <Badge
                              className={`border-none gap-1 w-fit ${row.assetType === 'option'
                                ? 'bg-orange-600 text-white'
                                : 'bg-slate-700 text-white'
                                }`}
                            >
                              <AssetTypeIcon
                                assetType={row.assetType as any}
                                className="h-3 w-3"
                              />
                              <span>{row.assetType === 'option' ? '期权' : '股票'}</span>
                            </Badge>
                            {row.netQty > 0 && (
                              <Badge className="bg-emerald-600 text-white border-none w-fit text-[10px] px-1.5 py-0 h-5">
                                多头
                              </Badge>
                            )}
                            {row.netQty < 0 && (
                              <Badge className="bg-red-600 text-white border-none w-fit text-[10px] px-1.5 py-0 h-5">
                                空头
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* 实时价格 + 实时价格状态徽章（来自价格中心）；颜色跟随当日盈亏 todayPl */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          <div className="flex items-center justify-end gap-2">
                            <span className={getTodayPlClassName(row.todayPl)}>
                              {fetchingSymbol === row.symbol ? (
                                <span className="mr-1 inline-block w-2 h-2 rounded-full bg-green-500 animate-ping" title="正在更新..."></span>
                              ) : row.todayPlStatus === 'stale-last' ? (
                                <span className="mr-1 inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="数据陈旧"></span>
                              ) : row.priceStatus === 'live' ? (
                                <span className="mr-1 inline-block w-2 h-2 rounded-full bg-green-500" title="实时数据"></span>
                              ) : null}
                              {formatCurrencyNoSign(row.last)}
                            </span>
                            {row.priceStatus && (
                              <StatusBadge
                                status={mapRtStatusToUiStatus(row.priceStatus)}
                                className="inline-flex items-center shrink-0 rounded-full px-2 text-[11px] h-5"
                              />
                            )}
                          </div>
                        </TableCell>

                        {/* 持仓数量 */}
                        <TableCell className="text-center font-mono text-sm md:text-base px-2">
                          {row.netQty.toFixed(2)}
                          {row.assetType === 'option' && (
                            <span className="text-muted-foreground text-xs ml-1">
                              ×{row.multiplier}
                            </span>
                          )}
                        </TableCell>

                        {/* 持仓单价 */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          {row.avgCost !== null ? row.avgCost.toFixed(4) : '—'}
                        </TableCell>

                        {/* 净现金投入（NCI） */}
                        <TableCell className="text-center font-mono text-sm md:text-base text-blue-600 px-2">
                          {formatCurrencyNoSign(costBasis)}
                        </TableCell>

                        {/* 盈亏平衡点 */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          {row.breakEvenPrice != null ? formatCurrencyNoSign(row.breakEvenPrice) : '—'}
                        </TableCell>

                        {/* 当日盈亏：仅金额（关注人） */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          <div className="flex items-center justify-end gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help flex items-center justify-end gap-2">
                                    {showRowTodayPlNumber(row) ? (
                                      <span className={getTodayPlClassName(row.todayPl)}>
                                        {formatCurrency(row.todayPl)}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        {isMissingEod
                                          ? '缺失EOD'
                                          : isMissingRealtime
                                            ? '缺实价'
                                            : '—'}
                                      </span>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-xs space-y-1 text-left">
                                    <p className="font-bold">调试信息 (Debug)</p>
                                    <div>Ref Price (实价): {row.refPrice ?? 'N/A'}</div>
                                    <div>Prev Close (昨收): {row.prevClose ?? 'N/A'}</div>
                                    <div>Ref Date (基准日): {row.refDateUsed ?? 'N/A'}</div>
                                    <div>Status: {row.todayPlStatus}</div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                      PnL = (Ref - Prev) * Qty
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>

                        {/* 当日变动：百分比 + 市值变动金额（关注货） */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          {(() => {
                            if (row.dayChange == null || row.dayChangePct == null) {
                              return <span className="text-muted-foreground">—</span>;
                            }
                            // 计算持仓市值变动 = 单股变动 * 数量 * 倍数
                            const positionChange = row.dayChange * row.netQty * (row.multiplier ?? 1);

                            return (
                              <span className={getTodayPlClassName(positionChange)}>
                                {formatPercent(row.dayChangePct)}
                                <span className="ml-1 text-[11px] md:text-xs">
                                  ({formatCurrency(positionChange)})
                                </span>
                              </span>
                            );
                          })()}
                        </TableCell>

                        {/* 持仓盈亏 */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          {(() => {
                            if (row.pnl == null || row.pnlPct == null) {
                              return <span className="text-muted-foreground">—</span>;
                            }
                            return (
                              <span className={getTodayPlClassName(row.pnl)}>
                                {formatPercent(row.pnlPct)}
                                <span className="ml-1 text-[11px] md:text-xs">
                                  ({formatCurrency(row.pnl)})
                                </span>
                              </span>
                            );
                          })()}
                        </TableCell>

                        {/* 个股全生命周期总盈亏 */}
                        <TableCell className="text-right font-mono text-sm md:text-base px-2">
                          {(() => {
                            if (row.totalLifetimePnL == null) {
                              return <span className="text-muted-foreground">—</span>;
                            }
                            return (
                              <span className={getTodayPlClassName(row.totalLifetimePnL)}>
                                {formatCurrency(row.totalLifetimePnL)}
                              </span>
                            );
                          })()}
                        </TableCell>

                        {/* 详情 */}
                        <TableCell className="text-center px-2">
                          <Link
                            href={`/symbol/${row.symbol}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-emerald-500"
                            title="查看详情"
                            prefetch={false}
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// 这里显式同时导出：默认导出 + 具名导出
export default HoldingsOverview;
export { HoldingsOverview };