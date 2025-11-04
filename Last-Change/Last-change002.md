
**操作时间**
*   **纽约**: 2024-07-29 14:15:10 (America/New_York)
*   **UTC**: 2024-07-29 18:15:10 (UTC)

---

#### **1. 修改文件： `/src/components/dashboard/holdings-overview.tsx`**

*   **修改前**:
    ```tsx
    'use client';

    import {
      Table,
      TableBody,
      TableCell,
      TableHead,
      TableHeader,
      TableRow,
    } from '@/components/ui/table';
    import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
    import { Button } from '@/components/ui/button';
    import { Badge } from '@/components/ui/badge';
    import { Skeleton } from '@/components/ui/skeleton';
    import { useUser } from '@/firebase';
    import { useUserTransactions } from '@/hooks/use-user-transactions';
    import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
    import { useMemo } from 'react';
    import { cn } from '@/lib/utils';
    import Link from 'next/link';
    import { PlusCircle } from 'lucide-react';
    
    export function HoldingsOverview() {
      const { user } = useUser();
      const { data: transactions, loading: isLoadingTransactions } = useUserTransactions(user?.uid);
    
      const snapshot = useMemo(() => {
        if (!transactions) {
          return { holdings: [], audit: {} };
        }
        return buildHoldingsSnapshot(transactions);
      }, [transactions]);
    
      if (isLoadingTransactions) {
        return (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            </CardContent>
          </Card>
        );
      }
    
      return (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>持仓概览</CardTitle>
            <Link href="/transactions/editor" passHref>
              <Button asChild variant="outline" size="sm" className="gap-1">
                <a>
                  <PlusCircle className="h-4 w-4" />
                  新增交易
                </a>
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>代码</TableHead>
                    <TableHead className="hidden sm:table-cell">最后交易日(NY)</TableHead>
                    <TableHead>方向</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">成本单价</TableHead>
                    <TableHead className="text-right hidden md:table-cell">持仓成本</TableHead>
                    <TableHead className="text-right">现价</TableHead>
                    <TableHead className="text-right">浮动盈亏</TableHead>
                    <TableHead className="hidden sm:table-cell">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.holdings.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="h-24 text-center text-muted-foreground"
                      >
                        无持仓（请先录入交易）
                      </TableCell>
                    </TableRow>
                  ) : (
                    snapshot.holdings.map((h) => (
                      <TableRow key={h.symbol}>
                        <TableCell className="font-mono">{h.symbol}</TableCell>
                        <TableCell className="hidden sm:table-cell font-mono text-xs">{h.lastTxNy}</TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              'border-none w-12 flex justify-center',
                              h.side === 'LONG'
                                ? 'bg-ok text-white'
                                : 'bg-destructive text-white'
                            )}
                          >
                            {h.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {h.netQty}
                          {h.multiplier !== 1 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              x{h.multiplier}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden sm:table-cell">
                          {h.costPerUnit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">
                          {h.costBasis.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono">{h.nowPrice ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono">{h.plFloating}</TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">{h.status}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );
    }
    ```

*   **修改后 (新文件内容)**:
    ```tsx
    'use client';

    import {
      Table,
      TableBody,
      TableCell,
      TableHead,
      TableHeader,
      TableRow,
    } from '@/components/ui/table';
    import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
    import { Button } from '@/components/ui/button';
    import { Badge } from '@/components/ui/badge';
    import { Skeleton } from '@/components/ui/skeleton';
    import { useUser } from '@/firebase';
    import { useUserTransactions } from '@/hooks/use-user-transactions';
    import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
    import { useMemo } from 'react';
    import { cn } from '@/lib/utils';
    import Link from 'next/link';
    import { PlusCircle } from 'lucide-react';
    
    export function HoldingsOverview() {
      const { user } = useUser();
      const { data: transactions, loading: isLoadingTransactions } = useUserTransactions(user?.uid);
    
      const snapshot = useMemo(() => {
        if (!transactions) {
          return { holdings: [], audit: {} };
        }
        return buildHoldingsSnapshot(transactions);
      }, [transactions]);
    
      if (isLoadingTransactions) {
        return (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            </CardContent>
          </Card>
        );
      }
    
      return (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>持仓概览</CardTitle>
            <Link href="/transactions/editor" passHref>
              <Button asChild variant="outline" size="sm" className="gap-1">
                <a>
                  <PlusCircle className="h-4 w-4" />
                  新增交易
                </a>
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>代码</TableHead>
                    <TableHead className="hidden sm:table-cell">最后交易日(NY)</TableHead>
                    <TableHead>方向</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">成本单价</TableHead>
                    <TableHead className="text-right hidden md:table-cell">持仓成本</TableHead>
                    <TableHead className="text-right">现价</TableHead>
                    <TableHead className="text-right">浮动盈亏</TableHead>
                    <TableHead className="hidden sm:table-cell">状态</TableHead>
                    <TableHead className="text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.holdings.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="h-24 text-center text-muted-foreground"
                      >
                        无持仓（请先录入交易）
                      </TableCell>
                    </TableRow>
                  ) : (
                    snapshot.holdings.map((h) => (
                      <TableRow key={h.symbol}>
                        <TableCell className="font-mono">{h.symbol}</TableCell>
                        <TableCell className="hidden sm:table-cell font-mono text-xs">{h.lastTxNy}</TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              'border-none w-12 flex justify-center',
                              h.side === 'LONG'
                                ? 'bg-ok text-white'
                                : 'bg-destructive text-white'
                            )}
                          >
                            {h.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {h.netQty}
                          {h.multiplier !== 1 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              x{h.multiplier}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden sm:table-cell">
                          {h.costPerUnit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">
                          {h.costBasis.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono">{h.nowPrice ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono">{h.plFloating}</TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">{h.status}</TableCell>
                        <TableCell className="text-center">
                            <Link href={`/transactions/editor?symbol=${encodeURIComponent(h.symbol)}`} passHref>
                                <Button asChild variant="outline" size="sm">
                                    <a>进入编辑器</a>
                                </Button>
                            </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );
    }
    ```

---

#### **2. 修改文件： `/src/app/transactions/editor/page.tsx`**

*   **修改前**:
    ```tsx
    'use client';

    import { useEffect, useState, Suspense } from 'react';
    import { useSearchParams, useRouter } from 'next/navigation';
    import { useFirestore, useUser } from '@/firebase';
    import { doc, getDoc } from 'firebase/firestore';
    import { AddTransactionForm } from '@/components/dashboard/add-transaction-form';
    import { Skeleton } from '@/components/ui/skeleton';
    import { Button } from '@/components/ui/button';
    
    type TxDoc = Record<string, any>;
    
    function TransactionEditor() {
      const sp = useSearchParams();
      const router = useRouter();
      const id = sp.get('id');
      const isEditing = Boolean(id);
      
      const { user, isUserLoading } = useUser();
      const firestore = useFirestore();
    
      const [loading, setLoading] = useState(isEditing);
      const [defaultValues, setDefaultValues] = useState<TxDoc | null>(null);
      const [error, setError] = useState<string | null>(null);
    
      useEffect(() => {
        let cancelled = false;
        async function load() {
          if (!isEditing || !user || !firestore) {
            if (isEditing) {
              setLoading(false);
            }
            return;
          }
          
          setLoading(true);
          setError(null);
          
          try {
            const ref = doc(firestore, 'users', user.uid, 'transactions', String(id));
            const snap = await getDoc(ref);
            if (!cancelled) {
              if (!snap.exists()) {
                setError('未找到该交易记录或您没有权限访问。');
              } else {
                setDefaultValues({ id, ...snap.data() });
              }
            }
          } catch (e: any) {
            if (!cancelled) {
              setError(e.message || '加载交易数据失败，请稍后再试。');
            }
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
        }
        
        if (!isUserLoading) {
          load();
        }
        
        return () => { cancelled = true; };
      }, [isEditing, id, user, isUserLoading, firestore]);
    
      const handleSuccess = () => {
        router.push('/#history'); 
      };
    
      const PageSkeleton = () => (
        <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <div className="space-y-6 pt-4">
                <Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-10 w-full" />
                <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-10 w-full" />
            </div>
        </div>
      );
    
      if (isUserLoading || (isEditing && loading)) {
        return (
          <div className="max-w-2xl mx-auto p-6">
            <PageSkeleton />
          </div>
        );
      }
      
      if (error) {
        return (
            <div className="max-w-2xl mx-auto p-6 bg-destructive/10 border border-destructive/50 rounded-lg text-destructive">
                <h2 className="font-semibold mb-2">加载错误</h2>
                <p>{error}</p>
                <Button onClick={() => router.back()} variant="outline" className="mt-4">返回</Button>
            </div>
        );
      }
    
      // For "add" mode, if user is not loaded yet, we can also show a skeleton.
      if (!isEditing && isUserLoading) {
         return (
          <div className="max-w-2xl mx-auto p-6">
            <PageSkeleton />
          </div>
        );
      }
    
      return (
        <div className="max-w-2xl mx-auto p-6">
          <h1 className="text-xl font-semibold mb-1">{isEditing ? '编辑交易' : '新增交易'}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {isEditing ? '修改您的交易记录。请谨慎操作。' : '记录一笔新的股票或期权交易。'}
          </p>
          <AddTransactionForm
            key={defaultValues?.id || 'new'}
            isEditing={isEditing}
            defaultValues={defaultValues ?? undefined}
            onSuccess={handleSuccess}
          />
        </div>
      );
    }
    
    export default function TransactionEditorPage() {
        return (
            <Suspense fallback={<div className="max-w-2xl mx-auto p-6"><h1 className="text-xl font-semibold mb-1">加载中...</h1></div>}>
                <TransactionEditor />
            </Suspense>
        )
    }
    ```

*   **修改后 (新文件内容)**:
    ```tsx
    'use client';

    import { useEffect, useState, Suspense } from 'react';
    import { useSearchParams, useRouter } from 'next/navigation';
    import { useFirestore, useUser } from '@/firebase';
    import { doc, getDoc } from 'firebase/firestore';
    import { AddTransactionForm } from '@/components/dashboard/add-transaction-form';
    import { Skeleton } from '@/components/ui/skeleton';
    import { Button } from '@/components/ui/button';
    
    type TxDoc = Record<string, any>;
    
    function TransactionEditor() {
      const sp = useSearchParams();
      const router = useRouter();
      const id = sp.get('id');
      const symbolFromQuery = sp.get('symbol');
      const isEditing = Boolean(id);
      
      const { user, isUserLoading } = useUser();
      const firestore = useFirestore();
    
      const [loading, setLoading] = useState(isEditing);
      const [defaultValues, setDefaultValues] = useState<TxDoc | null>(null);
      const [error, setError] = useState<string | null>(null);
    
      useEffect(() => {
        let cancelled = false;
        async function load() {
          if (!isEditing || !user || !firestore) {
            if (isEditing) {
              setLoading(false);
            } else if (symbolFromQuery) {
              // For "add" mode with a symbol pre-filled
              setDefaultValues({ symbol: symbolFromQuery.toUpperCase() });
            }
            return;
          }
          
          setLoading(true);
          setError(null);
          
          try {
            const ref = doc(firestore, 'users', user.uid, 'transactions', String(id));
            const snap = await getDoc(ref);
            if (!cancelled) {
              if (!snap.exists()) {
                setError('未找到该交易记录或您没有权限访问。');
              } else {
                setDefaultValues({ id, ...snap.data() });
              }
            }
          } catch (e: any) {
            if (!cancelled) {
              setError(e.message || '加载交易数据失败，请稍后再试。');
            }
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
        }
        
        if (!isUserLoading) {
          load();
        }
        
        return () => { cancelled = true; };
      }, [isEditing, id, user, isUserLoading, firestore, symbolFromQuery]);
    
      const handleSuccess = () => {
        router.push('/#history'); 
      };
    
      const PageSkeleton = () => (
        <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <div className="space-y-6 pt-4">
                <Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-10 w-full" />
                <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-10 w-full" />
            </div>
        </div>
      );
    
      // Determine initial values for the form
      const initialFormValues = isEditing 
        ? defaultValues 
        : (symbolFromQuery ? { symbol: symbolFromQuery.toUpperCase() } : undefined);
    
    
      if (isUserLoading || (isEditing && loading)) {
        return (
          <div className="max-w-2xl mx-auto p-6">
            <PageSkeleton />
          </div>
        );
      }
      
      if (error) {
        return (
            <div className="max-w-2xl mx-auto p-6 bg-destructive/10 border border-destructive/50 rounded-lg text-destructive">
                <h2 className="font-semibold mb-2">加载错误</h2>
                <p>{error}</p>
                <Button onClick={() => router.back()} variant="outline" className="mt-4">返回</Button>
            </div>
        );
      }
    
      // For "add" mode, if user is not loaded yet, we can also show a skeleton.
      if (!isEditing && isUserLoading) {
         return (
          <div className="max-w-2xl mx-auto p-6">
            <PageSkeleton />
          </div>
        );
      }
    
      return (
        <div className="max-w-2xl mx-auto p-6">
          <h1 className="text-xl font-semibold mb-1">{isEditing ? '编辑交易' : '新增交易'}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {isEditing ? '修改您的交易记录。请谨慎操作。' : '记录一笔新的股票或期权交易。'}
          </p>
          <AddTransactionForm
            key={defaultValues?.id || symbolFromQuery || 'new'}
            isEditing={isEditing}
            defaultValues={initialFormValues ?? undefined}
            onSuccess={handleSuccess}
          />
        </div>
      );
    }
    
    export default function TransactionEditorPage() {
        return (
            <Suspense fallback={<div className="max-w-2xl mx-auto p-6"><h1 className="text-xl font-semibold mb-1">加载中...</h1></div>}>
                <TransactionEditor />
            </Suspense>
        )
    }
    ```

