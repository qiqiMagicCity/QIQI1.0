'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '../ui/button';
import {
  Calendar as CalendarIcon,
  PlusCircle,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingDown,
  Undo2,
  Tag,
  Sparkles,
  Search,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';
import {
  useUser,
  useFirestore,
} from '@/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { Skeleton } from '../ui/skeleton';
import { SymbolName } from './symbol-name';
import { toNyCalendarDayString, toNyHmsString, nyWeekdayLabel, getEffectiveTradingDay } from '@/lib/ny-time';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useUserTransactions, type Tx, type OpKind } from '@/hooks/use-user-transactions';
import { useToast } from '@/hooks/use-toast';

const EditIcon = dynamic(() => import('@icon-park/react').then(m => m.Edit), {
  ssr: false,
});
const DeleteFiveIcon = dynamic(() => import('@icon-park/react').then(m => m.DeleteFive), {
  ssr: false,
});


const fmtNum = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPrice = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtInt = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function AssetBadge({ assetType }: { assetType: Tx['assetType'] }) {
  const isOption = assetType === 'option';
  return (
    <Badge
      className={cn(
        'text-white border-none gap-1',
        isOption ? 'bg-orange-600' : 'bg-slate-700'
      )}
    >
      <Tag className="w-3.5 h-3.5" />
      {isOption ? '期权' : '股票'}
    </Badge>
  );
}

// ... (ActionBadge function remains the same)

// ... (TransactionHistory component)



import { ActionBadge } from '@/components/common/action-badge';


import { addMonths, subMonths, format, startOfMonth, endOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ... (keep existing imports)

export function TransactionHistory() {
  // 默认显示当前月 (基于 NY 时间，Rule 2.1)
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const todayNy = getEffectiveTradingDay();
    const [y, m, d] = todayNy.split('-').map(Number);
    return new Date(y, m - 1, d); // Midnight local time but represents correct NY date
  });
  // 搜索状态
  const [searchSymbol, setSearchSymbol] = useState('');
  const [searchDate, setSearchDate] = useState<Date | undefined>(undefined);

  const isMobile = useIsMobile();

  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();

  function replaceQuery(next: (qs: URLSearchParams) => void) {
    const qs = new URLSearchParams(sp.toString());
    next(qs);
    const s = qs.toString();
    router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
  }

  function openNewTx() {
    replaceQuery(qs => {
      qs.set("tx", "new");
      qs.delete("id");
    });
  }

  function openBulkTx() {
    replaceQuery(qs => {
      qs.set("tx", "bulk");
      qs.delete("id");
    });
  }

  function openEditTx(id?: string) {
    if (!id || id === "null" || id === "undefined" || id.trim() === "") return; // 守卫
    replaceQuery(qs => {
      qs.set("tx", "edit");
      qs.set("id", id.trim());
    });
  }

  const { toast } = useToast();
  const firestore = useFirestore();
  const { user, impersonatedUid } = useUser();
  const effectiveUid = impersonatedUid || user?.uid;

  const { data, loading, error, warnings } = useUserTransactions(effectiveUid);

  // 计算当前月的起止日期（纽约时间字符串）
  const startNy = toNyCalendarDayString(startOfMonth(currentMonth));
  const endNy = toNyCalendarDayString(endOfMonth(currentMonth));

  const rows = useMemo(() => {
    if (!data?.length) return [];

    // 搜索模式：如果有搜索条件，则忽略月份筛选
    const isSearching = !!searchSymbol || !!searchDate;

    const filtered = data.filter(tx => {
      // 1. 标的搜索 (精确匹配)
      // 1. 标的搜索 (模糊匹配：支持搜索 "NKE" 匹配 "NKE" 和 "NKE 260109 C 65")
      if (searchSymbol) {
        const sym = tx.symbol.toUpperCase();
        const q = searchSymbol.toUpperCase().trim();
        if (!sym.includes(q)) return false;
      }

      // 2. 日期搜索 (精确匹配纽约日期)
      if (searchDate) {
        if (!tx.transactionTimestamp) return false;
        const txDate = toNyCalendarDayString(tx.transactionTimestamp);
        const targetDate = toNyCalendarDayString(searchDate);
        if (txDate !== targetDate) return false;
      }

      // 3. 如果没有搜索条件，则应用月份筛选
      if (!isSearching) {
        if (!tx.transactionTimestamp) return false;
        const d = toNyCalendarDayString(tx.transactionTimestamp);
        if (d < startNy || d > endNy) return false;
      }

      return true;
    });

    return filtered.map(tx => {
      const absQty = Math.abs(tx.qty);
      const amount = tx.qty * tx.price * tx.multiplier;
      return { ...tx, absQty, amount };
    });

  }, [data, startNy, endNy, searchSymbol, searchDate]);

  const handlePrevMonth = () => setCurrentMonth(prev => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth(prev => addMonths(prev, 1));

  const clearSearch = () => {
    setSearchSymbol('');
    setSearchDate(undefined);
  };

  // Delete logic
  async function handleDelete(tx: any) {
    try {
      const owner = tx?.userId ?? user?.uid ?? null;
      const ref = getTxDocRef(firestore, tx, owner);
      if (!ref) {
        toast({
          variant: "destructive",
          title: "删除失败",
          description: "无法定位该交易的文档路径。",
        });
        return;
      }
      await deleteDoc(ref);
      toast({
        title: "删除成功",
        description: "交易记录已删除。",
      });
    } catch (err: any) {
      console.error('[delete] 删除失败：', err);
      toast({
        variant: "destructive",
        title: "删除失败",
        description: `无法删除交易记录：${err?.message || String(err)}`,
      });
    }
  }

  return (
    <section id="history" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>交易历史</CardTitle>
              <CardDescription>所有过去交易的详细记录。</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={openBulkTx}>
                <PlusCircle className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">批量添加</span>
              </Button>
              <Button type="button" size="sm" className="h-8 gap-1" onClick={openNewTx}>
                <PlusCircle className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">添加交易</span>
              </Button>
            </div>
          </div>

          {/* 搜索工具栏 */}
          <div className="flex flex-wrap items-center gap-2 bg-muted/30 p-2 rounded-md border">
            <div className="relative w-full sm:w-48">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索标的..."
                value={searchSymbol}
                onChange={(e) => setSearchSymbol(e.target.value)}
                className="pl-8 h-9"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full sm:w-[180px] justify-start text-left font-normal h-9",
                    !searchDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {searchDate ? format(searchDate, "yyyy-MM-dd") : <span>选择日期</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={searchDate}
                  onSelect={setSearchDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            {(searchSymbol || searchDate) && (
              <Button variant="ghost" size="sm" onClick={clearSearch} className="h-9 px-2 lg:px-3">
                <X className="mr-2 h-4 w-4" />
                重置
              </Button>
            )}

            {/* Month Navigation (Only show when NOT searching) */}
            {(!searchSymbol && !searchDate) && (
              <div className="flex items-center border rounded-md bg-background ml-auto">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="px-2 text-sm font-medium min-w-[90px] text-center">
                  {format(currentMonth, 'yyyy年 MM月', { locale: zhCN })}
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        {warnings && warnings.length > 0 && (
          <div className="px-6 pb-2 -mt-4 text-xs text-amber-600 dark:text-amber-500">
            ⚠ 部分数据源加载失败或存在格式问题: {warnings.join('; ')}
          </div>
        )}
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <div className="min-w-[800px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">日期</TableHead>
                    <TableHead className="text-xs text-gray-400 w-[150px]">DEBUG: ID</TableHead>
                    <TableHead className="w-[100px]">标的代码</TableHead>
                    <TableHead className="hidden sm:table-cell w-[200px]">标的中文名</TableHead>
                    <TableHead className="w-[80px]">类型</TableHead>
                    <TableHead className="w-[80px]">操作</TableHead>
                    <TableHead className="text-right w-[100px]">价格</TableHead>
                    <TableHead className="text-right w-[100px]">数量</TableHead>
                    <TableHead className="text-right w-[120px]">总计金额</TableHead>
                    <TableHead className="text-center w-[100px]">管理</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={9}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {error && (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-center text-destructive"
                      >
                        加载失败: {error.message}
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && !error && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="h-24 text-center">
                        无记录。
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && !error &&
                    rows.map((tx) => (
                      <TableRow key={`${tx.source}-${tx.id}`}>
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
                        <TableCell className="text-[10px] text-gray-400 font-mono select-all break-all cursor-text max-w-[150px]">
                          {tx.id}
                        </TableCell>
                        <TableCell className="font-mono">{tx.symbol === 'UNKNOWN' ? '—' : tx.symbol}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <SymbolName symbol={tx.symbol} />
                        </TableCell>
                        <TableCell><AssetBadge assetType={tx.assetType} /></TableCell>
                        <TableCell><ActionBadge opKind={tx.opKind} /></TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtPrice(tx.price)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtInt(tx.absQty)}
                          {tx.multiplier !== 1 ? <span className="text-muted-foreground text-xs"> ×{fmtInt(tx.multiplier)}</span> : null}
                        </TableCell>
                        <TableCell className={cn('text-right font-mono', tx.amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
                          {fmtNum(tx.amount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center">
                            {/* Edit Button */}
                            {tx.source !== 'trades' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title="编辑"
                                className="mr-1 h-7 w-7 transition-transform hover:scale-110"
                                aria-label="编辑"
                                onClick={() => openEditTx(tx.id)}
                              >
                                <EditIcon
                                  theme="multi-color"
                                  size={18}
                                  strokeWidth={3}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  fill={["#34D399", "#FFFFFF", "#059669", "#065F46"]}
                                />
                              </Button>
                            )}
                            {/* Add Button for 'trades' source */}
                            {tx.source === 'trades' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title="新增 (基于此记录)"
                                className="mr-1 h-7 w-7 transition-transform hover:scale-110"
                                aria-label="新增"
                                onClick={openNewTx}
                              >
                                <PlusCircle
                                  size={18}
                                  strokeWidth={2}
                                  className="text-blue-500"
                                />
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="删除"
                                  className="h-7 w-7 transition-transform hover:scale-110"
                                  aria-label="删除"
                                  disabled={tx.source === 'trades'}
                                >
                                  <DeleteFiveIcon
                                    theme="multi-color"
                                    size={18}
                                    strokeWidth={3}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill={['#FCA5A5', '#FFFFFF', '#EF4444', '#991B1B']}
                                  />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>确认删除该交易？</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {tx.symbol} 将被永久删除，此操作不可撤销。
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>取消</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(tx)}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                  >
                                    确认删除
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
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

// Helper to get doc ref safely, returns null if params are missing
function getTxDocRef(firestore: any, tx: { id: string; source: 'transactions' | 'trades' }, ownerUid: string | null) {
  if (!firestore || !ownerUid || !tx?.id) return null;
  const collectionName = tx.source === 'trades' ? 'trades' : 'transactions';
  return doc(firestore, 'users', ownerUid, collectionName, tx.id);
}