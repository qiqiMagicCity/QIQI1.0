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
