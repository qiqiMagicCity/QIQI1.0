'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { format } from 'date-fns';
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
  Tag,
  ChevronRight,
  Pencil,
  Eye,
  EyeOff,
  Archive,
  Search,
  Layers
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ActionBadge } from '@/components/common/action-badge';
import { toNyCalendarDayString, toNyHmsString, nyWeekdayLabel } from '@/lib/ny-time';
import { ManualEodDialog } from './manual-eod-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateDoc, doc, collection, query, where, getDocs, setDoc } from 'firebase/firestore';
import { useFirestore, useUser } from '@/firebase';

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

// 动画数值组件
const AnimatedNumber = ({ value, children, className = '' }: { value: number | null | undefined, children: React.ReactNode, className?: string }) => {
  const [flash, setFlash] = useState<'green' | 'red' | null>(null);
  const prevValue = useRef(value);

  // 这里的 useEffect 逻辑：
  // 1. 只有当 value 真的变了（且都不是 null），才触发闪烁
  // 2. 闪烁后 1s 自动清除
  useEffect(() => {
    if (value == null || prevValue.current == null) {
      prevValue.current = value;
      return;
    }
    if (value === prevValue.current) return;

    if (value > prevValue.current) {
      setFlash('green');
    } else if (value < prevValue.current) {
      setFlash('red');
    }

    prevValue.current = value;

    const timer = setTimeout(() => {
      setFlash(null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [value]);

  const flashClass = flash === 'green' ? 'flash-green rounded px-1' : flash === 'red' ? 'flash-red rounded px-1' : '';

  return (
    <span className={`${className} ${flashClass} transition-colors duration-300`}>
      {children}
    </span>
  );
};

// [NEW] Manual Mark Dialog Component
const ManualMarkDialog = ({
  open,
  onOpenChange,
  symbol,
  currentPrice,
  onSuccess
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  currentPrice: number | null;
  onSuccess: () => void;
}) => {
  const [priceStr, setPriceStr] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const firestore = useFirestore();
  // [FIX] Update ManualMarkDialog to use effectiveUid from context
  const { effectiveUid } = useHoldings(); // Destructure effectiveUid from hook

  useEffect(() => {
    if (open) {
      setPriceStr(currentPrice != null ? currentPrice.toString() : '');
    }
  }, [open, currentPrice]);

  const handleSave = async () => {
    if (!symbol || !effectiveUid) {
      console.error('Missing symbol or effectiveUid');
      return;
    }
    const val = parseFloat(priceStr);
    if (isNaN(val)) return;

    setLoading(true);
    try {
      // Direct update by ID (Symbol) - handles both existing and new docs
      const normSym = symbol.trim().toUpperCase();
      const docRef = doc(firestore, 'users', effectiveUid, 'holdings', normSym);

      await setDoc(docRef, {
        symbol: normSym,
        manualMarkPrice: val,
        updatedAt: Date.now()
      }, { merge: true });

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update manual mark price:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>手动盯市 (Mark-to-Market)</DialogTitle>
          <DialogDescription>
            为期权 <b>{symbol}</b> 设置手动市场价格。
            <br />
            这将作为该期权的最新市价用于计算市值和盈亏。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="price" className="text-right">
              新价格
            </Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              className="col-span-3"
              autoFocus
              placeholder="例如: 1.55"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>取消</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper to parse option symbol "NVO261218C50" -> { underlying: 'NVO', date: '...', strike: '50', right: 'C' }
function parseOptionSymbol(raw: string) {
  const regex = /^([A-Z]+)(\d{6})([CP])([\d\.]+)$/;
  const match = raw.match(regex);
  if (!match) return null;

  const [, underlying, dateStr, right, strike] = match;
  // Parse YYMMDD
  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = parseInt(dateStr.slice(2, 4), 10);
  const dd = parseInt(dateStr.slice(4, 6), 10);

  const fullYear = 2000 + yy;
  // Format Date: "Dec 18 '26"
  const dateObj = new Date(fullYear, mm - 1, dd);
  const fmtDate = format(dateObj, "MMM d, ''yy"); // Dec 18, '26

  return {
    underlying,
    fmtDate,
    right, // C or P
    strike,
    typeDisplay: right === 'C' ? 'Call' : 'Put'
  };
}

const HoldingRowItem = ({
  row,
  fetchingSymbol,
  manualEodState,
  setManualEodState,
  onManualMark,
  toggleHidden,
  isRowHidden,
}: {
  row: any;
  fetchingSymbol: string | null;
  manualEodState: any;
  setManualEodState: (s: any) => void;
  onManualMark: (symbol: string, currentPrice: number | null) => void;
  toggleHidden: (symbol: string) => void;
  isRowHidden?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);

  // Detect Asset Type
  const isOption = row.assetType === 'option';

  // Layout Logic: Parse Option if needed
  const optDetails = isOption ? parseOptionSymbol(row.symbol) : null;

  return (
    <>
      <TableRow
        className={`group transition-all border-b border-border/40 relative
        ${isRowHidden
            ? 'opacity-50 grayscale bg-muted/20'
            : isOption
              // 1. Border: Solid 2px Left AND Right Borders (Symmetrical)
              // 2. Bg: Richer Violet/Indigo tint with a subtle inner glow
              ? 'bg-gradient-to-r from-violet-500/10 via-transparent to-violet-500/10 border-l-2 border-l-violet-500 border-r-2 border-r-violet-500 shadow-[inset_0_0_20px_-10px_rgba(139,92,246,0.3)] hover:bg-violet-500/15'
              : 'hover:bg-muted/50'
          }
        `}
      >
        {/* 1. Logo & Toggle & Status Orb */}
        <TableCell className="text-[13px] md:text-sm text-center px-2 py-3">
          <div className="flex items-center justify-center gap-2 group/arch">

            {/* [New] The "Alive" Indicator: A pulsing Status Orb */}
            {isOption && !isRowHidden && (
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_2px_rgba(139,92,246,0.6)] animate-pulse shrink-0" title="活跃期权合约" />
            )}

            {/* Logo Container */}
            <div className="relative">
              <div className={`transition-opacity ${isRowHidden ? 'opacity-0' : 'opacity-100 group-hover/arch:opacity-0'}`}>
                {/* Use Underlying for Logo if Option */}
                <CompanyLogo symbol={optDetails?.underlying || row.symbol} size={24} className={!(row.lots?.length) ? "mx-auto" : ""} />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(isRowHidden ? `恢复显示 ${row.symbol}?` : `确认隐藏 ${row.symbol}? \n\n隐藏后它将不再参与任何总资产计算。`)) {
                    toggleHidden(row.symbol);
                  }
                }}
                className={`absolute inset-0 flex items-center justify-center text-slate-400 hover:text-orange-500 transition-opacity ${isRowHidden ? 'opacity-100' : 'opacity-0 group-hover/arch:opacity-100'}`}
                title={isRowHidden ? "恢复显示 (Unhide)" : "隐藏此持仓 (Archive)"}
              >
                {isRowHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>

            {(row.lots && row.lots.length > 0) && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 text-slate-400 hover:text-foreground hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition ml-1"
                title="查看成本明细"
              >
                {expanded ? <ChevronsDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            )}
          </div>
        </TableCell>

        {/* 2. Symbol Column (Unified Typography) */}
        <TableCell className="px-2 py-3">
          {isOption && optDetails ? (
            <div className="flex flex-col">
              <span className="font-bold text-base leading-none text-foreground/90">{optDetails.underlying}</span>
              <span className="text-[10px] text-muted-foreground font-mono mt-0.5 opacity-70">{row.symbol}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Match Option Underlying Style exactly */}
              <span className="font-bold text-base leading-none text-foreground/90">{row.symbol}</span>
              {/* Optional: Add full name as small text if needed, or keep generic */}
            </div>
          )}
        </TableCell>

        {/* 3. Name / Contract Details Column */}
        <TableCell className="px-2 py-3">
          {isOption && optDetails ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`h-5 px-1.5 text-[11px] font-mono border-0 font-bold
                      ${optDetails.right === 'C'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'
                  }`}>
                  {optDetails.typeDisplay} {optDetails.strike}
                </Badge>
                <span className="text-sm font-medium text-foreground/90">{optDetails.fmtDate}</span>
              </div>
              {/* Fallback Name if needed, or remove. Usually "Name" for option is junk. */}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground"><SymbolName symbol={row.symbol} /></span>
          )}
        </TableCell>

        {/* 4. Type / Direction Badge */}
        <TableCell className="px-2 py-3">
          <div className="flex flex-wrap gap-1.5">
            {/* Main Asset Type Badge */}
            {!isOption ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                股票
              </Badge>
            ) : (
              // We already showed Call/Put nicely in Name col, maybe just show "Long/Short" here?
              // Or keep "Option" generic indicator?
              // Let's keep it clean.
              <div className="flex items-center text-[10px] text-muted-foreground font-medium">
                <Layers className="w-3 h-3 mr-1 opacity-70" />
                期权
              </div>
            )}

            {/* Position Direction / Option Strategy */}
            {isOption && optDetails ? (
              (() => {
                const isLong = row.netQty > 0;
                const right = optDetails.right as 'C' | 'P'; // Safe casting
                const strat = isLong
                  ? (right === 'C'
                    ? { label: '做多·看涨', sub: 'Long Call', tip: '杠杆看涨', color: 'emerald' }
                    : { label: '做多·看跌', sub: 'Long Put', tip: '对冲/做空', color: 'emerald' })
                  : (right === 'C'
                    ? { label: '卖出·备兑', sub: 'Covered Call', tip: '增强收益/不看大涨', color: 'orange' }
                    : { label: '卖出·抄底', sub: 'Short Put', tip: '权利金/等待建仓', color: 'orange' });

                const colorClasses = strat.color === 'emerald'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100'
                  : 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400 hover:bg-orange-100';

                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge className={`h-5 px-1.5 text-[10px] cursor-help border ${colorClasses}`}>
                          {strat.label}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs">
                          <p className="font-bold">{strat.sub}</p>
                          <p className="opacity-80">{strat.tip}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })()
            ) : (
              // Stock / Fallback Logic
              <>
                {row.netQty > 0 && (
                  <Badge className="h-5 px-1.5 text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100">
                    多头
                  </Badge>
                )}
                {row.netQty < 0 && (
                  <Badge className="h-5 px-1.5 text-[10px] border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 hover:bg-rose-100">
                    空头
                  </Badge>
                )}
              </>
            )}
          </div>
        </TableCell>

        {/* 5. Last Price (Updated logic for Options) */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2 py-3">
          <div className="flex flex-col items-end gap-0.5">
            <span className={getTodayPlClassName(row.todayPl)}>
              {/* [MODIFIED] Option Manual Mark UI */}
              {isOption ? (
                <div
                  className="flex items-center gap-1 cursor-pointer group/pencil hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-1 -mr-1 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onManualMark(row.symbol, row.last);
                  }}
                  title="点击手动修改价格"
                >
                  <AnimatedNumber value={row.last} className="inline-block border-b border-dashed border-slate-400 group-hover/pencil:border-emerald-500">
                    {formatCurrencyNoSign(row.last)}
                  </AnimatedNumber>
                  <Pencil className="w-3 h-3 text-slate-400 group-hover/pencil:text-emerald-500 opacity-0 group-hover/pencil:opacity-100 transition-opacity" />
                </div>
              ) : (
                <>
                  {fetchingSymbol === row.symbol ? (
                    <span className="mr-1 inline-block w-2 h-2 rounded-full bg-green-500 animate-ping" title="正在更新..."></span>
                  ) : row.todayPlStatus === 'stale-last' ? (
                    <span className="mr-1 inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="数据陈旧"></span>
                  ) : row.priceStatus === 'live' ? (
                    <span className="mr-1 inline-block w-2 h-2 rounded-full bg-green-500" title="实时数据"></span>
                  ) : null}
                  <AnimatedNumber value={row.last} className="inline-block">
                    {formatCurrencyNoSign(row.last)}
                  </AnimatedNumber>
                </>
              )}
            </span>
            {row.priceStatus && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <StatusBadge
                        status={mapRtStatusToUiStatus(row.priceStatus)}
                        className="inline-flex items-center shrink-0 rounded-full px-2 text-[11px] h-5"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs space-y-1">
                      <p className="font-bold">
                        {row.priceStatus === 'stale' ? '数据陈旧 (Stale)' :
                          row.priceStatus === 'pending' ? '等待更新 (Pending)' :
                            row.priceStatus === 'live' ? '实时数据 (Live)' :
                              row.priceStatus === 'closed' ? '已收盘 (Closed)' : '未知状态'}
                      </p>
                      {row.lastUpdatedTs ? (
                        <p>上次更新: {toNyHmsString(row.lastUpdatedTs)}</p>
                      ) : (
                        <p className="opacity-70">无更新时间记录</p>
                      )}
                      {row.priceStatus === 'stale' && (
                        <p className="text-orange-400">数据超过60秒未更新</p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>

              </TooltipProvider>
            )}
          </div>
        </TableCell>

        {/* 6. Net Qty */}
        <TableCell className="text-center font-mono text-sm md:text-base px-2 text-sky-400">
          {Number.isInteger(row.netQty) ? row.netQty : row.netQty.toFixed(2)}
          {row.assetType === 'option' && (
            <span className="text-muted-foreground text-xs ml-1">
              ×{row.multiplier}
            </span>
          )}
        </TableCell>

        {/* 7. Avg Cost */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2 text-amber-400">
          {row.avgCost !== null ? row.avgCost.toFixed(4) : '—'}
        </TableCell>

        {/* 8. NCI */}
        <TableCell className="text-center font-mono text-sm md:text-base text-blue-600 px-2">
          {formatCurrencyNoSign(
            row.avgCost != null
              ? Math.abs(row.netQty) * (row.multiplier ?? 1) * row.avgCost
              : null
          )}
        </TableCell>

        {/* 9. Break Even */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2 text-violet-400">
          {row.breakEvenPrice != null ? formatCurrencyNoSign(row.breakEvenPrice) : '—'}
        </TableCell>

        {/* 10. Today Pl */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2">
          <div className="flex items-center justify-end gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help flex items-center justify-end gap-2">
                    {showRowTodayPlNumber(row) ? (
                      <span className={getTodayPlClassName(row.todayPl)}>
                        <AnimatedNumber value={row.todayPl}>
                          {formatCurrency(row.todayPl)}
                        </AnimatedNumber>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {(row.todayPlStatus === 'missing-ref-eod' ||
                          row.todayPlStatus === 'missing-today-eod' ||
                          row.todayPlStatus === 'pending-eod-fetch') ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (row.refDateUsed) {
                                setManualEodState({
                                  open: true,
                                  symbol: row.symbol,
                                  date: row.refDateUsed
                                });
                              }
                            }}
                            className="text-red-400 hover:text-red-300 underline decoration-dashed underline-offset-2 cursor-pointer transition-colors"
                            title="点击手动录入数据"
                          >
                            缺失EOD
                          </button>
                        ) : row.todayPlStatus === 'degraded' ? (
                          '缺实价'
                        ) : (
                          '—'
                        )}
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
                      PnL = (Ref - Prev) * Qty {row.multiplier !== 1 ? `* ${row.multiplier}` : ''}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </TableCell>

        {/* 11. Day Change */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2">
          {(() => {
            if (row.dayChange == null || row.dayChangePct == null) {
              return <span className="text-muted-foreground">—</span>;
            }
            const positionChange = row.dayChange * row.netQty * (row.multiplier ?? 1);

            return (
              <div className={`flex flex-col items-end ${getTodayPlClassName(positionChange)}`}>
                <AnimatedNumber value={positionChange}>
                  <span>{formatCurrency(positionChange)}</span>
                </AnimatedNumber>
                <span className="text-[11px] md:text-xs opacity-80">
                  ({formatPercent(row.dayChangePct)})
                </span>
              </div>
            );
          })()}
        </TableCell>

        {/* 12. Holding PnL */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2">
          {(() => {
            if (row.pnl == null || row.pnlPct == null) {
              return <span className="text-muted-foreground">—</span>;
            }
            return (
              <div className={`flex flex-col items-end ${getTodayPlClassName(row.pnl)}`}>
                <span>{formatPercent(row.pnlPct)}</span>
                <span className="text-[11px] md:text-xs opacity-80">
                  <AnimatedNumber value={row.pnl}>
                    ({formatCurrency(row.pnl)})
                  </AnimatedNumber>
                </span>
              </div>
            );
          })()}
        </TableCell>

        {/* 13. Realized PnL */}
        <TableCell className="text-right font-mono text-sm md:text-base px-2">
          {(() => {
            const val = row.realizedPnl ?? 0;
            return (
              <span className={getTodayPlClassName(val)}>
                <AnimatedNumber value={val}>
                  {formatCurrency(val)}
                </AnimatedNumber>
              </span>
            );
          })()}
        </TableCell>

        {/* 14. Detail Link */}
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

      {/* EXPANDED DETAILS */}
      {expanded && (
        <TableRow className="bg-slate-50/50 dark:bg-slate-900/50">
          <TableCell colSpan={15} className="p-0">
            <div className="p-4 pl-14 md:pl-20 border-b relative">
              <div className="absolute left-6 top-0 bottom-0 w-px bg-border border-dashed dark:border-slate-800" />
              <div className="absolute left-6 top-6 w-6 h-px bg-border border-dashed dark:border-slate-800" />

              <div className="rounded-md border bg-card/50 overflow-hidden max-w-2xl">
                <div className="bg-muted/50 px-4 py-2 border-b flex justify-between items-center">
                  <span className="font-semibold text-xs">成本明细 (FIFO Layers)</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="h-8 border-none hover:bg-transparent bg-muted/20">
                      <TableHead className="h-8 text-xs w-[180px]">开仓时间</TableHead>
                      <TableHead className="h-8 text-xs text-right">数量</TableHead>
                      <TableHead className="h-8 text-xs text-right">成本 (Cost)</TableHead>
                      <TableHead className="h-8 text-xs text-right">总投 (Basis)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.lots?.map((lot: any, idx: number) => {
                      const basis = Math.abs(lot.qty) * lot.price * (row.multiplier ?? 1);
                      return (
                        <TableRow key={idx} className="h-8 border-none hover:bg-black/5 dark:hover:bg-white/5">
                          <TableCell className="py-1 text-xs">
                            <span className="font-mono">{toNyCalendarDayString(new Date(lot.ts))}</span>
                            <span className="text-muted-foreground ml-2 text-[10px]">{toNyHmsString(new Date(lot.ts))}</span>
                          </TableCell>
                          <TableCell className="py-1 text-xs text-right font-mono">
                            {lot.qty > 0 ? (
                              <span className="text-emerald-500">+{lot.qty}</span>
                            ) : (
                              <span className="text-red-500">{lot.qty}</span>
                            )}
                          </TableCell>
                          <TableCell className="py-1 text-xs text-right font-mono text-amber-400">
                            {lot.price.toFixed(4)}
                          </TableCell>
                          <TableCell className="py-1 text-xs text-right font-mono text-blue-400">
                            {formatCurrencyNoSign(basis)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

function HoldingsOverview() {
  const { rows, loading, transactions, refreshData, showHidden, setShowHidden, toggleHidden } = useHoldings();
  const { fetchingSymbol } = usePriceCenterContext();


  // Manual EOD State
  const [manualEodState, setManualEodState] = useState<{ open: boolean; symbol: string; date: string } | null>(null);

  // [NEW] Manual Mark State
  const [manualMarkState, setManualMarkState] = useState<{ open: boolean; symbol: string; currentPrice: number | null }>({
    open: false,
    symbol: '',
    currentPrice: null
  });

  const handleManualMark = (symbol: string, currentPrice: number | null) => {
    setManualMarkState({ open: true, symbol, currentPrice });
  };

  const handleManualMarkSuccess = () => {
    refreshData();
  };

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
    // [MODIFIED] Filter Logic:
    // 1. Show Active Positions (Net Qty > 0)
    // 2. Show Positions with Activity Today (Day Change != 0), even if closed (Net Qty = 0)
    //    This ensures that if you sell everything today, you still see the result of that trade for the rest of the day.
    const activeRows = rows.filter((row) =>
      Math.abs(row.netQty) > 0.0001 ||
      (row.dayChange && Math.abs(row.dayChange) > 0.0001)
    );

    if (!sortConfig.direction) return activeRows;

    const sorted = [...activeRows].sort((a, b) => {
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

      // 优先级 0：Option 永远沉底 (Force Option to Bottom)
      // Since a and b are row objects, we can access .assetType directly.
      const aIsOpt = a.assetType === 'option';
      const bIsOpt = b.assetType === 'option';

      if (aIsOpt !== bIsOpt) {
        // If one is option and the other is not, Option always goes LAST (bottom)
        return aIsOpt ? 1 : -1;
      }

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
    <>
      <section id="holdings" className="scroll-mt-20">
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <CardTitle className="text-base md:text-lg">持仓概览</CardTitle>
              <div className="flex items-center gap-2">
                <Switch
                  checked={showHidden}
                  onCheckedChange={setShowHidden}
                  id="show-hidden-mode"
                  className="scale-75 origin-left"
                />
                <Label htmlFor="show-hidden-mode" className="text-xs text-muted-foreground font-normal cursor-pointer">
                  {showHidden ? "显示隐藏项" : "隐藏项 (Hide)"}
                </Label>
              </div>
            </div>
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
                      <span className="text-sky-400">持仓</span>
                    </SortableHeader>
                    <SortableHeader sortKey="avgCost" className="text-right px-2">
                      <span className="text-amber-400">成本</span>
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
                    <TableHead className="text-right px-2 text-violet-400">
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

                  {!loading && sortedRows.filter(r => !r.isHidden).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={15} className="h-24 text-center">
                        无持仓（请先录入交易）
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading &&
                    sortedRows.filter(r => !r.isHidden).map((row, index, arr) => {
                      // DIVIDER LOGIC:
                      // Check IF current row is OPTION and previous row was STOCK
                      // Note: We need to check against the *filtered* array logic, but since we are inside map of filtered,
                      // index refers to position in the filtered list. That's perfect.
                      const prevRow = index > 0 ? arr[index - 1] : null;
                      const showDivider = row.assetType === 'option' && (!prevRow || prevRow.assetType !== 'option');

                      return (
                        <React.Fragment key={`${row.symbol}-${row.assetType}-${row.multiplier ?? 1}`}>
                          {showDivider && (
                            <TableRow className="hover:bg-transparent border-b-0">
                              <TableCell colSpan={15} className="p-0">
                                <div className="flex items-center justify-center py-8 relative group/divider">
                                  {/* Elegant Fading Line */}
                                  <div className="absolute inset-0 flex items-center px-4" aria-hidden="true">
                                    <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-300 dark:via-slate-700 to-transparent opacity-50"></div>
                                  </div>

                                  {/* Minimalist Pill Badge */}
                                  <div className="relative flex justify-center">
                                    <span className="
                                       bg-background px-5 py-1 
                                       rounded-full text-[11px] font-medium tracking-widest 
                                       text-slate-500 dark:text-slate-400 
                                       border border-slate-200 dark:border-slate-800 
                                       shadow-sm flex items-center gap-2
                                       select-none
                                     ">
                                      <Layers className="w-3.5 h-3.5 opacity-70" />
                                      期权区 · OPTIONS
                                    </span>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          <HoldingRowItem
                            row={row}
                            fetchingSymbol={fetchingSymbol}
                            manualEodState={manualEodState}
                            setManualEodState={setManualEodState}
                            onManualMark={handleManualMark}
                            toggleHidden={toggleHidden}
                            isRowHidden={row.isHidden}
                          />
                        </React.Fragment>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* [NEW] Residual Data / Hidden Holdings Table */}
      {
        showHidden && sortedRows.filter(r => r.isHidden).length > 0 && (
          <section id="hidden-holdings" className="mt-8">
            <Card className="border-dashed border-slate-400/50 bg-slate-50/30 dark:bg-slate-900/10">
              <CardHeader>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Archive className="h-5 w-5" />
                  <CardTitle className="text-base md:text-lg">残留数据 (隐藏部分)</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0 text-[13px] md:text-sm">
                <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center px-2 w-[50px]">logo</TableHead>
                        <SortableHeader sortKey="symbol" className="px-2">代码</SortableHeader>
                        <TableHead className="px-2">中文名</TableHead>
                        <SortableHeader sortKey="assetType" className="px-2">类型</SortableHeader>
                        <SortableHeader sortKey="last" className="text-right px-2">现价</SortableHeader>
                        <SortableHeader sortKey="netQty" className="text-right px-2"><span className="text-sky-400">持仓</span></SortableHeader>
                        <SortableHeader sortKey="avgCost" className="text-right px-2"><span className="text-amber-400/50">成本</span></SortableHeader>
                        <SortableHeader sortKey="costBasis" className="text-right px-2">NCI</SortableHeader>
                        <TableHead className="text-right px-2 text-violet-400/50">保本价</TableHead>
                        <SortableHeader sortKey="todayPl" className="text-right px-2">日盈亏</SortableHeader>
                        <SortableHeader sortKey="dayChangePct" className="text-right px-2">日变动</SortableHeader>
                        <TableHead className="text-right px-2 text-muted-foreground">持仓盈亏</TableHead>
                        <TableHead className="text-right px-2 text-muted-foreground">已实现</TableHead>
                        <TableHead className="text-center px-2 text-muted-foreground w-[50px]">详情</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRows.filter(r => r.isHidden).map((row) => (
                        <HoldingRowItem
                          key={`${row.symbol}-${row.assetType}-${row.multiplier ?? 1}`}
                          row={row}
                          fetchingSymbol={fetchingSymbol}
                          manualEodState={manualEodState}
                          setManualEodState={setManualEodState}
                          onManualMark={handleManualMark}
                          toggleHidden={toggleHidden}
                          isRowHidden={row.isHidden}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </section>
        )
      }

      {/* Manual EOD Dialog */}
      {
        manualEodState && (
          <ManualEodDialog
            open={manualEodState.open}
            onOpenChange={(open) => setManualEodState(prev => prev ? { ...prev, open } : null)}
            symbol={manualEodState.symbol}
            date={manualEodState.date}
            onSuccess={() => {
              refreshData();
            }}
          />
        )
      }

      {/* [NEW] Manual Mark Dialog */}
      <ManualMarkDialog
        open={manualMarkState.open}
        onOpenChange={(open) => setManualMarkState(prev => ({ ...prev, open }))}
        symbol={manualMarkState.symbol}
        currentPrice={manualMarkState.currentPrice}
        onSuccess={handleManualMarkSuccess}
      />


      {/* [NEW] Recent Transactions Section (Full Detail) */}
      <section className="mt-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base md:text-lg">近期交易 (最新17条)</CardTitle>
              <Link href="/?tab=history">
                <Button variant="outline" size="sm" className="gap-1">
                  查看全部
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 text-[13px] md:text-sm">
            <div className="w-full overflow-x-auto">
              <div className="min-w-[800px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">日期</TableHead>
                      <TableHead className="w-[100px]">标的代码</TableHead>
                      <TableHead className="hidden sm:table-cell w-[200px]">标的中文名</TableHead>
                      <TableHead className="w-[80px]">类型</TableHead>
                      <TableHead className="w-[80px]">操作</TableHead>
                      <TableHead className="text-right w-[100px]">价格</TableHead>
                      <TableHead className="text-right w-[100px]">数量</TableHead>
                      <TableHead className="text-right w-[120px]">总计金额</TableHead>
                      <TableHead className="text-center w-[50px]"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && rows.length === 0 ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={9}>
                            <div className="h-6 w-full animate-pulse bg-muted/50 rounded" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      // Logic: Get transactions, Sort Descending, Slice 17
                      (transactions || [])
                        .slice() // Clone to avoid mutation
                        .sort((a, b) => b.transactionTimestamp - a.transactionTimestamp)
                        .slice(0, 17)
                        .map((tx) => {
                          const absQty = Math.abs(tx.qty);
                          const amount = tx.qty * tx.price * tx.multiplier;
                          const isOption = tx.assetType === 'option';

                          return (
                            <TableRow key={tx.id || Math.random()}>
                              <TableCell>
                                <div>
                                  {tx.transactionTimestamp ? (
                                    <>
                                      {toNyCalendarDayString(tx.transactionTimestamp)}{' '}
                                      <span className="hidden sm:inline">{toNyHmsString(tx.transactionTimestamp)}</span>
                                    </>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </div>
                                <div className="text-xs text-muted-foreground -mt-1">
                                  {tx.transactionTimestamp ? nyWeekdayLabel(tx.transactionTimestamp) : null}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono">{tx.symbol === 'UNKNOWN' ? '—' : tx.symbol}</TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <SymbolName symbol={tx.symbol} />
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={`text-white border-none gap-1 ${isOption ? 'bg-orange-600' : 'bg-slate-700'
                                    }`}
                                >
                                  <Tag className="w-3.5 h-3.5" />
                                  {isOption ? '期权' : '股票'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <ActionBadge opKind={tx.opKind} />
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {Number(tx.price).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {Number(absQty).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                {tx.multiplier !== 1 ? <span className="text-muted-foreground text-xs"> ×{tx.multiplier}</span> : null}
                              </TableCell>
                              <TableCell className={`text-right font-mono ${amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                {Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-center w-[50px]">
                                {/* Empty Action Column for visual parity */}
                              </TableCell>
                            </TableRow>
                          );
                        })
                    )}
                    {!loading && (transactions || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">无记录。</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="h-8"></div>
      </section>
    </>
  );
}

// 这里显式同时导出：默认导出 + 具名导出
export default HoldingsOverview;
export { HoldingsOverview };