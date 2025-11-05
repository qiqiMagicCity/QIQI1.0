'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { useFirestore, useUser } from '@/firebase';
import { useUserTransactions, type Tx } from './use-user-transactions';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';

export interface HoldingRow {
  symbol: string;
  assetType: 'stock' | 'option';
  netQty: number;
  avgCost: number | null;
  multiplier: number;           // 股票=1；期权=合约乘数（通常100）
  last: number | null;          // 最新价（优先 last，其次 close）
  mv: number | null;            // 市值
  pnl: number | null;           // 浮盈
  pnlPct: number | null;        // 盈亏率
}

export function useHoldings() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { data: transactions, loading: txLoading } = useUserTransactions(user?.uid);

  // 1) 从交易记录派生“基础持仓层”
  const baseHoldings = useMemo(() => {
    const list = Array.isArray(transactions) ? (transactions as Tx[]) : [];
    if (list.length === 0) return [];
    const snap = buildHoldingsSnapshot(list);
    return snap.holdings ?? [];
  }, [transactions]);

  // 2) 为持仓中的 symbols 订阅价格
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const uniqueSymbols = useMemo(
    () => Array.from(new Set(baseHoldings.map(h => h.symbol))).filter(Boolean),
    [baseHoldings]
  );

  useEffect(() => {
    if (!firestore || uniqueSymbols.length === 0) {
      setPrices({});
      setPriceLoading(false);
      return;
    }

    setPrices({});
    setPriceLoading(true);

    const unsubs: Unsubscribe[] = uniqueSymbols.map((symbol) => {
      const ref = doc(firestore, 'stockDetails', symbol);
      return onSnapshot(ref, (snap) => {
        if (!snap.exists()) {
          setPrices(prev => ({ ...prev, [symbol]: null }));
          return;
        }
        const data: any = snap.data();
        const price = (data?.last ?? data?.close ?? null) as number | null;
        setPrices(prev => ({ ...prev, [symbol]: price }));
      });
    });

    setPriceLoading(false);

    return () => {
      unsubs.forEach(u => u());
    };
  }, [firestore, uniqueSymbols]);

  // 3) 组装最终行（含 MV / PnL / PnL%）
  const rows: HoldingRow[] = useMemo(() => {
    return baseHoldings.map((h: any) => {
      const symbol: string = h.symbol;
      const netQty: number = h.netQty ?? h.netQuantity ?? 0;
      const avgCost: number | null = h.costPerUnit ?? h.averageCost ?? null;
      const multiplier: number = h.multiplier ?? 1;
      const assetType: 'stock' | 'option' = h.assetType ?? (multiplier !== 1 ? 'option' : 'stock');

      const last = prices[symbol] ?? null;

      let mv: number | null = null;
      if (last !== null) {
        mv = netQty * multiplier * last;
      }

      let pnl: number | null = null;
      if (mv !== null && avgCost !== null) {
        const cost = netQty * multiplier * avgCost;
        pnl = mv - cost;
      }

      let pnlPct: number | null = null;
      if (pnl !== null && avgCost !== null && avgCost !== 0) {
        const denom = Math.abs(netQty) * multiplier * avgCost;
        pnlPct = denom ? pnl / denom : null;
      }

      return { symbol, assetType, netQty, avgCost, multiplier, last, mv, pnl, pnlPct };
    });
  }, [baseHoldings, prices]);

  const loading = txLoading || priceLoading;
  return { rows, loading };
}