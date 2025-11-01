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
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { useMemo, useState, useEffect } from 'react';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  useCollection,
  useUser,
  useFirestore,
  useMemoFirebase,
} from '@/firebase';
import type { Transaction } from '@/lib/data';
import { collection, query, orderBy, doc, deleteDoc, collectionGroup, getDocs, where, orderBy as fbOrderBy, limit as fbLimit } from 'firebase/firestore';
import { AddTransactionForm } from './add-transaction-form';
import { Skeleton } from '../ui/skeleton';
import { SymbolName } from './symbol-name';
import { toNyCalendarDayString } from '@/lib/ny-time';
import dynamic from 'next/dynamic';

const DEBUG_HISTORY = true; // 仅调试用；验证完可删/置 false

const EditIcon = dynamic(() => import('@icon-park/react').then(m => m.Edit), {
  ssr: false,
});
const DeleteFiveIcon = dynamic(() => import('@icon-park/react').then(m => m.DeleteFive), {
  ssr: false,
});


// Helper to get doc ref safely, returns null if params are missing
function getTxDocRef(firestore: any, tx: any, ownerUid: any) {
  if (firestore && tx && tx.id && ownerUid) {
    return doc(firestore, 'users', ownerUid, 'transactions', tx.id);
  }
  return null;
}

function getTxNyString(tx: any): string | null {
  // 1) 优先用已存在的字段
  if (typeof tx.transactionDateNy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.transactionDateNy)) {
    return tx.transactionDateNy;
  }
  // 2) 否则从 ISO 或时间戳派生（只读计算，严禁写回 DB）
  if (tx.transactionDate) {
    const d = new Date(tx.transactionDate);
    if (!isNaN(d.getTime())) return toNyCalendarDayString(d);
  }
  if (typeof tx.transactionTimestamp === 'number') {
    const d = new Date(tx.transactionTimestamp);
    if (!isNaN(d.getTime())) return toNyCalendarDayString(d);
  }
  return null;
}

// ============================================================
// 第 2 部分：“日期兜底”与数据标准化函数
// ============================================================
function normalizeTx(rawTx: any, source: 'transactions' | 'trades'): any {
  let timestamp: number = 0;
  let hasValidTimestamp = false;
  let rawDate: any = null;

  const getTimestampFromDateString = (dateStr: any) => {
    if (typeof dateStr !== 'string' || !dateStr) return null;
    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : parsed;
  }

  // 1. 检查 number 类型的 transactionTimestamp
  if (typeof rawTx.transactionTimestamp === 'number') {
    timestamp = rawTx.transactionTimestamp;
    rawDate = new Date(timestamp).toISOString();
    hasValidTimestamp = true;
  }

  // 2. 检查 Firestore Timestamp 对象
  if (!hasValidTimestamp && rawTx.createdAt) {
    rawDate = rawTx.createdAt;
    if (typeof rawTx.createdAt.toMillis === 'function') {
      timestamp = rawTx.createdAt.toMillis();
      hasValidTimestamp = true;
    } else if (typeof rawTx.createdAt.seconds === 'number') {
      timestamp = rawTx.createdAt.seconds * 1000;
      hasValidTimestamp = true;
    }
  }

  // 3. 检查各种字符串日期字段
  if (!hasValidTimestamp) {
    const dateFields = ['transactionDate', 'date', 'tradeDate'];
    for(const field of dateFields) {
      const fromStr = getTimestampFromDateString(rawTx[field]);
      if (fromStr !== null) {
        timestamp = fromStr;
        rawDate = rawTx[field];
        hasValidTimestamp = true;
        break;
      }
    }
  }

  if (!hasValidTimestamp) {
    timestamp = 0; // Fallback for very old/broken data
  }

  return {
    ...rawTx,
    id: rawTx.id,
    source,
    transactionTimestamp: timestamp,
    rawDate: rawDate,
    __incomplete: !hasValidTimestamp,
  };
}


export function TransactionHistory() {
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  const [isAddFormOpen, setAddFormOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<any>(null); // For edit dialog

  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

  const transactionsQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    const coll = collection(firestore, 'users', user.uid, 'transactions');
    return query(coll, orderBy('transactionTimestamp', 'desc'));
  }, [user, firestore]);

  const {
    data: transactions,
    isLoading: isTransactionsLoading,
    error,
  } = useCollection<Transaction>(transactionsQuery);

  const tradesQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    const coll = collection(firestore, 'users', user.uid, 'trades');
    return query(coll);
  }, [user, firestore]);

  const {
    data: trades,
    isLoading: isTradesLoading,
  } = useCollection<Transaction>(tradesQuery);

  const baseRows = useMemo(() => {
    const rows: Array<any> = [];

    (transactions ?? []).forEach((item) => {
      rows.push(normalizeTx(item, 'transactions'));
    });

    (trades ?? []).forEach((item) => {
      rows.push(normalizeTx(item, 'trades'));
    });

    rows.sort((a, b) => {
      const at = a.transactionTimestamp ?? 0;
      const bt = b.transactionTimestamp ?? 0;
      return bt - at; // newest first
    });

    return rows;
  }, [transactions, trades]);
  
  const startNy = date?.from ? toNyCalendarDayString(date.from) : null;
  const endNy   = date?.to   ? toNyCalendarDayString(date.to)   : startNy;

  const filteredTransactions = useMemo(() => {
    const rows = baseRows;
    if (!rows) return [];
    if (!startNy || !endNy) return rows;
    return rows.filter((tx) => {
      const txNy = getTxNyString(tx);
      if (!txNy) return false;
      return txNy >= startNy && txNy <= endNy;
    });
  }, [baseRows, startNy, endNy]);

  const isLoading = isUserLoading || isTransactionsLoading || isTradesLoading;

  useEffect(() => {
    if (!DEBUG_HISTORY) return;

    const snapshot = {
      uid: user?.uid ?? null,
      isUserLoading,
      isTransactionsLoading,
      isTradesLoading,
      isLoading,
      error: error?.message ?? null,
      counts: {
        transactions: Array.isArray(transactions) ? transactions.length : null,
        trades: Array.isArray(trades) ? trades.length : null,
        baseRows: Array.isArray(baseRows) ? baseRows.length : null,
      },
      samples: {
        trades: (trades ?? []).slice(0, 3).map((t: any) => ({
          id: t.id ?? '(no id)',
          ts_type: typeof t.transactionTimestamp,
          ts: t.transactionTimestamp ?? null,
          date_type: t.transactionDate === null ? 'null' : typeof t.transactionDate,
          date: t.transactionDate ?? null,
          ny: getTxNyString(t),
        })),
        base: (baseRows ?? []).slice(0, 3).map((t: any) => ({
          id: t.id ?? '(no id)',
          source: t.source,
          ts_type: typeof t.transactionTimestamp,
          ts: t.transactionTimestamp ?? null,
          ny: getTxNyString(t),
          incomplete: t.__incomplete
        })),
      },
    };

    (window as any).__HISTORY_DEBUG_LAST = snapshot;
    // eslint-disable-next-line no-console
    console.log('[HistoryDebug]', JSON.stringify(snapshot, null, 2));
  }, [
    user,
    isUserLoading,
    isTransactionsLoading,
    isTradesLoading,
    isLoading,
    error,
    transactions,
    trades,
    baseRows,
    filteredTransactions,
  ]);

  useEffect(() => {
    if (!user || !firestore) return;
  
    (async () => {
      try {
        const cg = collectionGroup(firestore, "transactions");
        // 只读：找出所有 userId 等于当前 UID 的交易
        const q = query(
          cg,
          where("userId", "==", user.uid),
          fbOrderBy("transactionTimestamp", "desc"),
          fbLimit(3)
        );
        const snap = await getDocs(q);
        const sample = snap.docs.map(d => ({ path: d.ref.path, ...d.data() })).slice(0, 3);
        // eslint-disable-next-line no-console
        console.log(
          "[HistoryProbe][collectionGroup by userId]",
          JSON.stringify({ uid: user.uid, count: snap.size, sample }, null, 2)
        );
        (window as any).__HISTORY_PROBE_LAST = { uid: user.uid, count: snap.size, sample };
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("[HistoryProbe][collectionGroup error]", e?.message || e);
      }
    })();
  }, [user, firestore]);

  // Edit logic
  const openEdit = (tx: any) => {
    setEditingTx(tx);
  };
  const closeEdit = () => {
    setEditingTx(null);
  };
  const handleEditSuccess = () => {
    closeEdit();
  };

  // Delete logic
  async function handleDelete(tx: any) {
    try {
      const ref = getTxDocRef(firestore, tx, user?.uid);
      if (!ref) {
        console.warn('[delete] 无法定位文档路径，缺少 ref/ownerUid/id', tx);
        alert('删除失败：无法定位该交易的文档路径（缺少 ref/ownerUid/id）。');
        return;
      }
      await deleteDoc(ref);
    } catch (err: any) {
      console.error('[delete] 删除失败：', err);
      alert(`删除失败：${err?.message || String(err)}`);
    }
  }

  // ============================================================
  // 第 1 部分：已修复语法错误
  // ============================================================
  return (
    <section id="history" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle>交易历史</CardTitle>
            <CardDescription>所有过去交易的详细记录。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={isAddFormOpen} onOpenChange={setAddFormOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 gap-1">
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                    添加交易
                  </span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>添加一笔新交易</DialogTitle>
                  <DialogDescription>
                    请填写以下信息以记录您的新交易。
                  </DialogDescription>
                </DialogHeader>
                <AddTransactionForm onSuccess={() => setAddFormOpen(false)} />
              </DialogContent>
            </Dialog>
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
                        {format(date.from, 'y-MM-dd', { locale: zhCN })} -{' '}
                        {format(date.to, 'y-MM-dd', { locale: zhCN })}
                      </>
                    ) : (
                      format(date.from, 'y-MM-dd', { locale: zhCN })
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
                  numberOfMonths={2}
                  locale={zhCN}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        {DEBUG_HISTORY && (
          <div className="px-4 -mt-2 text-xs text-muted-foreground">
            uid: {user?.uid ?? 'n/a'} · 抓到: (tx:{Array.isArray(transactions) ? transactions.length : 'n/a'} + tr:{Array.isArray(trades) ? trades.length : 'n/a'})
            · 过滤后: {Array.isArray(filteredTransactions) ? filteredTransactions.length : 'n/a'}
          </div>
        )}
        <CardContent className="p-0">
          <div className="relative w-full overflow-auto">
            <Table className="tx-table w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>标的</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">价格</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">总计</TableHead>
                  <TableHead className="text-center">管理</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {error && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-destructive"
                    >
                      加载失败: {error.message}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && filteredTransactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      无记录。
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filteredTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap">
                        {getTxNyString(tx) ?? '—'}
                      </TableCell>
                      <TableCell className="font-medium">
                        <SymbolName symbol={tx.symbol} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            tx.type === 'Buy'
                              ? 'default'
                              : 'destructive'
                          }
                          className={cn(
                            'w-[40px] flex justify-center',
                            tx.type === 'Buy' && 'bg-ok',
                            tx.type === 'Sell' && 'bg-negative'
                          )}
                        >
                          {tx.type === 'Buy' ? '买' : '卖'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {tx.price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {tx.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(tx.price * tx.quantity).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="编辑"
                            onClick={() => openEdit(tx)}
                            className="mr-1 h-7 w-7 transition-transform hover:scale-110"
                            aria-label="编辑"
                          >
                            <EditIcon
                              theme="multi-color"
                              size={18}
                              strokeWidth={3}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill={['#34D399', '#FFFFFF', '#059669', '#065F46']}
                            />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="删除"
                                className="h-7 w-7 transition-transform hover:scale-110"
                                aria-label="删除"
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
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingTx} onOpenChange={(isOpen) => !isOpen && closeEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑交易</DialogTitle>
            <DialogDescription>
              修改您的交易记录。请谨慎操作。
            </DialogDescription>
          </DialogHeader>
          {editingTx && (
            <AddTransactionForm
              key={editingTx.id} /* Force re-render */
              isEditing={true}
              defaultValues={editingTx}
              onSuccess={handleEditSuccess}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
