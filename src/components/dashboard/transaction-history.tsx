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
} from 'lucide-react';
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
import { toNyCalendarDayString, toNyHmsString, nyWeekdayLabel } from '@/lib/ny-time';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useUserTransactions, type Tx, type OpKind } from '@/hooks/use-user-transactions';

const EditIcon = dynamic(() => import('@icon-park/react').then(m => m.Edit), {
  ssr: false,
});
const DeleteFiveIcon = dynamic(() => import('@icon-park/react').then(m => m.DeleteFive), {
  ssr: false,
});


const fmtNum = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// 让“操作”列对【股票与期权】使用同一套标签与色板（买入/卖出/卖空/补回）
function ActionBadge({ opKind }: { opKind: OpKind }) {
  const PALETTE = {
    BUY:  'bg-emerald-600',
    SELL: 'bg-red-600',
    SHORT:'bg-violet-600',
    COVER:'bg-blue-600',
    // 期权动作映射到同色板（保持一致）
    BTO:  'bg-emerald-600',
    STC:  'bg-red-600',
    STO:  'bg-violet-600',
    BTC:  'bg-blue-600',
  } as const;

  const Icon =
    opKind === 'SHORT' || opKind === 'STO' ? TrendingDown
    : opKind === 'COVER' || opKind === 'BTC' ? Undo2
    : opKind === 'SELL'  || opKind === 'STC' ? ArrowDownLeft
    : ArrowUpRight;

  const text =
    opKind === 'BTO'   ? '买入' :
    opKind === 'STO'   ? '卖空' :
    opKind === 'STC'   ? '卖出' :
    opKind === 'BTC'   ? '补回' :
    opKind === 'SELL'  ? '卖出' :
    opKind === 'SHORT' ? '卖空' :
    opKind === 'COVER' ? '补回' : '买入';

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-white', PALETTE[opKind])}>
      <Icon className="w-3.5 h-3.5" />
      <span>{text}</span>
    </span>
  );
}


export function TransactionHistory() {
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  const isMobile = useIsMobile();

  const firestore = useFirestore();
  const { user } = useUser();

  const { data, loading, error, warnings } = useUserTransactions(user?.uid);
  
  const startNy = date?.from ? toNyCalendarDayString(date.from) : null;
  const endNy   = date?.to   ? toNyCalendarDayString(date.to)   : startNy;

  const rows = useMemo(() => {
    if (!data?.length) return [];
  
    const filtered = (!startNy || !endNy) ? data : data.filter(tx => {
      if (!tx.transactionTimestamp) return false;
      const d = toNyCalendarDayString(tx.transactionTimestamp);
      const s = startNy <= endNy ? startNy : endNy;
      const e = startNy <= endNy ? endNy : startNy;
      return d >= s && d <= e;
    });

    return filtered.map(tx => {
        const absQty = Math.abs(tx.qty);
        const amount = tx.qty * tx.price * tx.multiplier;
        return { ...tx, absQty, amount };
    });

  }, [data, startNy, endNy]);

  // Delete logic
  async function handleDelete(tx: any) {
    try {
      const ref = getTxDocRef(firestore, tx, user?.uid ?? null);
      if (!ref) {
        let msg = '删除失败：无法定位该交易的文档路径。';
        if(tx.source === 'trades') {
            msg = '历史导入的 `trades` 记录当前为只读状态，无法删除。'
        }
        console.warn('[delete] ' + msg, tx);
        alert(msg);
        return;
      }
      await deleteDoc(ref);
    } catch (err: any) {
      console.error('[delete] 删除失败：', err);
      alert(`删除失败：${err?.message || String(err)}`);
    }
  }

  return (
    <section id="history" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle>交易历史</CardTitle>
            <CardDescription>所有过去交易的详细记录。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/transactions/editor" passHref>
                <Button asChild size="sm" className="h-8 gap-1">
                <a>
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                        添加交易
                    </span>
                </a>
                </Button>
            </Link>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant={'outline'}
                  size="sm"
                  className={cn(
                    'h-8 w-full md:w-[240px] justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {toNyCalendarDayString(date.from)} - {toNyCalendarDayString(date.to)}
                      </>
                    ) : (
                      toNyCalendarDayString(date.from)
                    )
                  ) : (
                    <span>选择一个日期</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={date?.from}
                  selected={date}
                  onSelect={setDate}
                  numberOfMonths={isMobile ? 1 : 2}
                  locale={zhCN}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        {warnings && warnings.length > 0 && (
          <div className="px-6 pb-2 -mt-4 text-xs text-amber-600 dark:text-amber-500">
             ⚠ 部分数据源加载失败或存在格式问题: {warnings.join('; ')}
          </div>
        )}
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <div className="min-w-[800px] sm:min-w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">日期</TableHead>
                    <TableHead>标的代码</TableHead>
                    <TableHead className="hidden sm:table-cell">标的中文名</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>操作</TableHead>
                    <TableHead className="text-right">价格</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">总计金额</TableHead>
                    <TableHead className="text-center">管理</TableHead>
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
                        <TableCell className="font-mono">{tx.symbol === 'UNKNOWN' ? '—' : tx.symbol}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <SymbolName symbol={tx.symbol} />
                        </TableCell>
                        <TableCell><AssetBadge assetType={tx.assetType} /></TableCell>
                        <TableCell><ActionBadge opKind={tx.opKind} /></TableCell>
                        <TableCell className="text-right font-mono">
                           {fmtNum(tx.price)}
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
                            <Link href={`/transactions/editor?id=${tx.id}`} passHref>
                              <Button asChild variant="ghost" size="icon" title="编辑" className="mr-1 h-7 w-7 transition-transform hover:scale-110" aria-label="编辑" disabled={tx.source === 'trades'}>
                                <a>
                                  <EditIcon
                                    theme="multi-color"
                                    size={18}
                                    strokeWidth={3}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill={['#34D399', '#FFFFFF', '#059669', '#065F46']}
                                  />
                                </a>
                              </Button>
                            </Link>
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
   if (tx.source !== 'transactions') return null; // 'trades' 只读
   return doc(firestore, 'users', ownerUid, 'transactions', tx.id);
}
