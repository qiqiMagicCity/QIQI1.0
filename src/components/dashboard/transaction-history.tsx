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
import { collection, query, orderBy, doc, deleteDoc, collectionGroup, where } from 'firebase/firestore';
import { AddTransactionForm } from './add-transaction-form';
import { Skeleton } from '../ui/skeleton';
import { SymbolName } from './symbol-name';
import { toNyCalendarDayString } from '@/lib/ny-time';
import dynamic from 'next/dynamic';

const DEBUG_HISTORY = true; 

const EditIcon = dynamic(() => import('@icon-park/react').then(m => m.Edit), {
  ssr: false,
});
const DeleteFiveIcon = dynamic(() => import('@icon-park/react').then(m => m.DeleteFive), {
  ssr: false,
});


// Helper to get doc ref safely, returns null if params are missing
function getTxDocRef(firestore: any, tx: any, ownerUid: any) {
  if (firestore && tx && tx.id && ownerUid && tx.source === 'transactions') {
    return doc(firestore, 'users', ownerUid, 'transactions', tx.id);
  }
  // Deletion/Editing of 'trades' is disabled for now.
  return null;
}

function getTxNyString(tx: any): string | null {
  // 已有的 NY 日字段，且格式正确，直接返回
  if (typeof tx.transactionDateNy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.transactionDateNy)) {
    return tx.transactionDateNy;
  }

  // 尝试把各种可能的“时间字段”统一解析为 Date
  const tryToDate = (v: any): Date | null => {
    if (!v && v !== 0) return null;

    // Firestore Timestamp
    if (typeof v === 'object' && v && typeof v.toMillis === 'function') {
      const d = new Date(v.toMillis());
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'object' && v && typeof v.seconds === 'number') {
      const d = new Date(v.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }

    // number: 视为毫秒时间戳
    if (typeof v === 'number') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }

    // string: 允许 ISO / 含时区 / 简单日期字符串
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  };

  // 优先级：transactionDate → date → tradeDate → createdAt → transactionTimestamp
  const candidates = [
    tx.transactionDate,
    tx.date,
    tx.tradeDate,
    tx.createdAt,
    tx.transactionTimestamp,
  ];

  for (const c of candidates) {
    const d = tryToDate(c);
    if (d) return toNyCalendarDayString(d); // 统一入口：纽约交易日 YYYY-MM-DD
  }

  return null; // 仍解析不了则返回空，交由上层显示 '—'
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
      if (rawTx[field]) {
        const fromStr = getTimestampFromDateString(rawTx[field]);
        if (fromStr !== null) {
          timestamp = fromStr;
          rawDate = rawTx[field];
          hasValidTimestamp = true;
          break;
        }
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
    return query(collection(firestore, 'users', user.uid, 'transactions'), orderBy('transactionTimestamp', 'desc'));
  }, [user, firestore]);

  const {
    data: transactions,
    isLoading: isTransactionsLoading,
    error,
  } = useCollection<Transaction>(transactionsQuery);

  const tradesQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collectionGroup(firestore, 'trades'), where('userId', '==', user.uid));
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
        filtered: Array.isArray(filteredTransactions) ? filteredTransactions.length : null,
      },
      queries: {
        transactions: transactionsQuery?.type,
        trades: tradesQuery?.type
      }
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
    transactionsQuery,
    tradesQuery
  ]);

  // Edit logic
  const openEdit = (tx: any) => {
    if (tx.source !== 'transactions') {
        alert('历史导入的 `trades` 记录当前为只读状态，无法编辑。请通过“添加交易”功能创建新记录进行调整。');
        return;
    }
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
                        {(() => {
                          const p = Number(String(tx.price ?? '').replace(/,/g, ''));
                          return Number.isFinite(p) ? p.toFixed(2) : '—';
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const q = Number(String(tx.quantity ?? '').replace(/,/g, ''));
                          return Number.isFinite(q) ? q : (tx.quantity ?? '—');
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const p = Number(String(tx.price ?? '').replace(/,/g, ''));
                          const q = Number(String(tx.quantity ?? '').replace(/,/g, ''));
                          if (Number.isFinite(p) && Number.isFinite(q)) {
                            return (p * q).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          }
                          return '—';
                        })()}
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
