'use client';
import React, { useEffect, useState } from 'react';
import { useFirestore, useUser } from '@/firebase';
import { collectionGroup, query, where, limit, getDocs } from 'firebase/firestore';

export default function ProbePage() {
  const fs = useFirestore();
  const { user } = useUser();
  const [out, setOut] = useState<any>({ status: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        if (!fs || !user) { setOut({ status: 'waiting-auth-or-fs' }); return; }
        const uid = user.uid;
        const qTx = query(collectionGroup(fs, 'transactions'), where('userId', '==', uid), limit(3));
        const qTr = query(collectionGroup(fs, 'trades'), where('userId', '==', uid), limit(3));
        const [sTx, sTr] = await Promise.all([
          getDocs(qTx),
          getDocs(qTr),
        ]);
        // 为了拿到总数，再各跑一次不带 limit 的 count（Firestore没原生count，这里简化：再取全部并读size。
        // 若数据很多可后续改为 count aggregation，这里预计数据量可接受）
        const [sTxAll, sTrAll] = await Promise.all([
          getDocs(query(collectionGroup(fs, 'transactions'), where('userId', '==', uid))),
          getDocs(query(collectionGroup(fs, 'trades'), where('userId', '==', uid))),
        ]);
        const pick = (snap: any) => snap.docs.map((d: any) => ({ path: d.ref.path, ...d.data() }));
        setOut({
          status: 'ok',
          uid,
          totals: { transactions: sTxAll.size, trades: sTrAll.size },
          samples: { transactions: pick(sTx), trades: pick(sTr) },
        });
      } catch (e: any) {
        setOut({ status: 'error', message: e?.message || String(e) });
      }
    })();
  }, [fs, user]);

  return (
    <main className="p-4">
      <pre className="text-xs whitespace-pre-wrap">
        {JSON.stringify(out, null, 2)}
      </pre>
    </main>
  );
}
