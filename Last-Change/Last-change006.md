*   **纽约**: 2024-07-30 14:30:00 (America/New_York)
*   **UTC**: 2024-07-30 18:30:00 (UTC)

---

#### **1. 修改文件： `src/hooks/use-user-transactions.ts`**

*   **修改前**:
    ```ts
    'use client';

    import { useEffect, useState } from 'react';
    import {
      collection,
      query,
      orderBy,
      onSnapshot,
    } from 'firebase/firestore';
    import { useFirestore } from '@/firebase';

    export type AssetType = 'stock' | 'option';
    export type TxType = 'Buy' | 'Sell' | 'Short Sell' | 'Short Cover';
    export type Side = 'BUY' | 'SELL';

    // Raw type from Firestore
    export interface FireTx {
      id: string;
      symbol?: string;
      assetType?: AssetType;
      type?: TxType; // new form uses 'type'
      action?: TxType; // legacy might use 'action'
      side?: TxType;
      qty?: number;
      price?: number;
      multiplier?: number;
      transactionTimestamp?: number; // UTC ms
    }

    // Clean, normalized type for use in the app
    export interface Tx {
      id: string;
      symbol: string;
      assetType: AssetType;
      type: TxType;
      side: Side;
      qty: number; // BUY > 0, SELL < 0
      price: number;
      multiplier: number; // stock=1, option=100
      transactionTimestamp: number;
      source: 'transactions' | 'trades';
    }

    function normalizeFireTx(raw: FireTx, source: 'transactions' | 'trades'): Tx | null {
      if (
        !raw.symbol ||
        typeof raw.qty !== 'number' ||
        typeof raw.price !== 'number' ||
        typeof raw.transactionTimestamp !== 'number'
      ) {
        return null; // Rule 2.2: Skip if essential data is missing
      }

      const assetType: AssetType = raw.assetType ?? 'stock';
      
      // Unify 'type', 'action', and 'side' fields
      const type: TxType = raw.type || raw.action || raw.side || (raw.qty >= 0 ? 'Buy' : 'Sell');

      let qty = raw.qty;
      let side: Side;
      
      // Determine side and normalize quantity
      if (type === 'Sell' || type === 'Short Sell') {
        side = 'SELL';
        qty = -Math.abs(qty);
      } else { // 'BUY' or 'Short Cover' or inferred
        side = 'BUY';
        qty = Math.abs(qty);
      }

      const multiplier =
        typeof raw.multiplier === 'number'
          ? raw.multiplier
          : assetType === 'option'
          ? 100
          : 1;

      return {
        id: raw.id,
        symbol: raw.symbol.toUpperCase(),
        assetType,
        type, // Keep original type for display
        side, // Add unified side for calculation
        qty,
        price: raw.price,
        multiplier,
        transactionTimestamp: raw.transactionTimestamp,
        source,
      };
    }

    export function useUserTransactions(uid?: string | null) {
      const [data, setData] = useState<Tx[]>([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState<Error | null>(null);
      const [warnings, setWarnings] = useState<string[]>([]);
      const firestore = useFirestore();

      useEffect(() => {
        if (!uid || !firestore) {
          setData([]);
          setLoading(!uid);
          setError(null);
          setWarnings([]);
          return;
        }

        setLoading(true);
        setError(null);
        setWarnings([]);
        const combined = new Map<string, Tx>();

        type Lane = { ok: boolean; done: boolean; err?: string | null; count: number; };
        const lanes = {
          transactions: { ok: false, done: false, err: null, count: 0 } as Lane,
          trades: { ok: false, done: false, err: null, count: 0 } as Lane,
        };

        const updateState = () => {
          setData(Array.from(combined.values()).sort((a, b) => b.transactionTimestamp - a.transactionTimestamp));

          const bothDone = lanes.transactions.done && lanes.trades.done;
          if (bothDone) {
            setLoading(false);
          }

          const bothFail = bothDone && !lanes.transactions.ok && !lanes.trades.ok;

          if (bothFail) {
            setError(new Error(lanes.transactions.err ?? lanes.trades.err ?? 'Both data sources failed to load.'));
            setWarnings([]);
          } else {
            setError(null);
            const ws: string[] = [];
            if (lanes.transactions.err) {
              ws.push(`Failed to load 'transactions': ${'\'\'\''}lanes.transactions.err`\'\'\'`);
            }
            if (lanes.trades.err) {
              ws.push(`Failed to load 'trades': ${'\'\'\''}lanes.trades.err`\'\'\'`);
            }
            setWarnings(ws);
          }
        };

        const subscribe = (col: 'transactions' | 'trades') => {
          const ref = collection(firestore, 'users', uid, col);
          const q = query(ref, orderBy('transactionTimestamp', 'desc'));

          return onSnapshot(q,
            (snap) => {
              snap.docs.forEach((d) => {
                const raw = { id: d.id, ...d.data() } as FireTx;
                const norm = normalizeFireTx(raw, col);
                if (norm) {
                  combined.set(`${'\'\'\''}col`-'\'\''${'\'\'\''}d.id`\'\'\'`, norm);
                }
              });
              lanes[col].ok = true;
              lanes[col].done = true;
              lanes[col].count = snap.size;
              updateState();
            },
            (err) => {
              lanes[col].ok = false;
              lanes[col].done = true;
              lanes[col].err = err?.message || 'Subscription failed';
              updateState();
            }
          );
        };

        const unsubTransactions = subscribe('transactions');
        const unsubTrades = subscribe('trades');

        return () => {
          unsubTransactions();
          unsubTrades();
        };
      }, [uid, firestore]);

      return { data, loading, error, warnings };
    }
    ```

*   **修改后 (新文件内容)**:
    ```ts
    'use client';

    import { useEffect, useState } from 'react';
    import {
      collection,
      query,
      orderBy,
      onSnapshot,
    } from 'firebase/firestore';
    import { useFirestore } from '@/firebase';

    export type AssetType = 'stock' | 'option';
    export type TxType = 'Buy' | 'Sell' | 'Short Sell' | 'Short Cover';
    export type Side = 'BUY' | 'SELL';

    // Raw type from Firestore
    export interface FireTx {
      id: string;
      symbol?: string;
      assetType?: AssetType | 'options';
      type?: TxType; // new form uses 'type'
      action?: TxType; // legacy might use 'action'
      side?: TxType;
      qty?: number | string;
      price?: number | string;
      multiplier?: number;
      transactionTimestamp?: number | string | { toMillis: () => number }; // UTC ms, ISO string, or Firestore Timestamp
    }

    // Clean, normalized type for use in the app
    export interface Tx {
      id: string;
      symbol: string;
      assetType: AssetType;
      type: TxType;
      side: Side;
      qty: number; // BUY > 0, SELL < 0
      price: number;
      multiplier: number; // stock=1, option=100
      transactionTimestamp: number;
      source: 'transactions' | 'trades';
    }

    function isFirestoreTimestamp(v: any): v is { toMillis: () => number } {
      return v && typeof v.toMillis === 'function';
    }

    function parseNumberLoose(v: unknown): number | null {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const t = v.trim();
        if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          return Number.isFinite(n) ? n : null;
        }
      }
      return null;
    }

    function parseTsToMillis(v: unknown): number | null {
      if (typeof v === 'number' && Number.isFinite(v)) {
        // 10位秒或13位毫秒的宽松判断
        return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
      }
      if (isFirestoreTimestamp(v)) {
        const n = v.toMillis();
        return Number.isFinite(n) ? n : null;
      }
      if (typeof v === 'string') {
        const t = v.trim();
        // 纯数字字符串
        if (/^\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
        }
        // ISO 字符串
        const d = Date.parse(t);
        if (Number.isFinite(d)) return d;
      }
      return null;
    }

    function normalizeFireTx(raw: FireTx, source: 'transactions' | 'trades'): Tx | null {
      const symbol = raw.symbol?.trim()?.toUpperCase();
      if (!symbol) return null;

      // assetType 归一
      const at = (raw.assetType ?? 'stock').toString().toLowerCase();
      const assetType: AssetType = (at === 'option' || at === 'options') ? 'option' : 'stock';

      // 解析 qty/price
      const qtyNum = parseNumberLoose(raw.qty);
      const priceNum = parseNumberLoose(raw.price);
      if (qtyNum === null || priceNum === null) return null;

      // 解析 ts
      const ts = parseTsToMillis(raw.transactionTimestamp as any);
      if (ts === null) return null; // 关键字段缺失则跳过——符合 Rule 2.2

      // 统一 type/side → side & qty 符号
      const rawType = (raw.type || raw.action || (raw.side as any)) as TxType | string | undefined;
      const tLower = (rawType ?? (qtyNum >= 0 ? 'Buy' : 'Sell')).toString().toLowerCase();
      let side: Side;
      let qty = qtyNum;

      if (tLower.includes('sell') && !tLower.includes('cover')) {
        side = 'SELL';
        qty = -Math.abs(qty);
      } else {
        // Buy 或 Short Cover 或未知 → 视为 BUY
        side = 'BUY';
        qty = Math.abs(qty);
      }

      const multiplier =
        typeof raw.multiplier === 'number'
          ? raw.multiplier
          : assetType === 'option'
          ? 100
          : 1;

      // 回填原始 type（用于 UI 文案），保留大小写，若无则派生 'Buy'/'Sell'
      const type: TxType = (rawType as TxType) ?? (side === 'BUY' ? 'Buy' : 'Sell');

      return {
        id: raw.id,
        symbol,
        assetType,
        type,
        side,
        qty,
        price: priceNum,
        multiplier,
        transactionTimestamp: ts,
        source,
      };
    }


    export function useUserTransactions(uid?: string | null) {
      const [data, setData] = useState<Tx[]>([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState<Error | null>(null);
      const [warnings, setWarnings] = useState<string[]>([]);
      const firestore = useFirestore();

      useEffect(() => {
        if (!uid || !firestore) {
          setData([]);
          setLoading(!uid);
          setError(null);
          setWarnings([]);
          return;
        }

        setLoading(true);
        setError(null);
        setWarnings([]);
        const combined = new Map<string, Tx>();

        type Lane = { ok: boolean; done: boolean; err?: string | null; count: number; };
        const lanes = {
          transactions: { ok: false, done: false, err: null, count: 0 } as Lane,
          trades: { ok: false, done: false, err: null, count: 0 } as Lane,
        };

        const updateState = () => {
          setData(Array.from(combined.values()).sort((a, b) => b.transactionTimestamp - a.transactionTimestamp));

          const bothDone = lanes.transactions.done && lanes.trades.done;
          if (bothDone) {
            setLoading(false);
          }

          const bothFail = bothDone && !lanes.transactions.ok && !lanes.trades.ok;

          if (bothFail) {
            setError(new Error(lanes.transactions.err ?? lanes.trades.err ?? 'Both data sources failed to load.'));
            setWarnings([]);
          } else {
            setError(null);
            const ws: string[] = [];
            if (lanes.transactions.err) {
              ws.push(`Failed to load 'transactions': ${'\'\'\''}lanes.transactions.err`\'\'\'`);
            }
            if (lanes.trades.err) {
              ws.push(`Failed to load 'trades': ${'\'\'\''}lanes.trades.err`\'\'\'`);
            }
            setWarnings(ws);
          }
        };

        const subscribe = (col: 'transactions' | 'trades') => {
          const ref = collection(firestore, 'users', uid, col);
          const q = query(ref, orderBy('transactionTimestamp', 'desc'));

          return onSnapshot(q,
            (snap) => {
              snap.docs.forEach((d) => {
                const raw = { id: d.id, ...d.data() } as FireTx;
                const norm = normalizeFireTx(raw, col);
                if (norm) {
                  combined.set(`${'\'\'\''}col`-'\'\''${'\'\'\''}d.id`\'\'\'`, norm);
                }
              });
              lanes[col === 'transactions' ? 'transactions' : 'trades'].ok = true;
              lanes[col === 'transactions' ? 'transactions' : 'trades'].done = true;
              lanes[col === 'transactions' ? 'transactions' : 'trades'].count = snap.size;
              updateState();
            },
            (err) => {
              lanes[col === 'transactions' ? 'transactions' : 'trades'].ok = false;
              lanes[col === 'transactions' ? 'transactions' : 'trades'].done = true;
              lanes[col === 'transactions' ? 'transactions' : 'trades'].err = err?.message || 'Subscription failed';
              updateState();
            }
          );
        };

        const unsubTransactions = subscribe('transactions');
        const unsubTrades = subscribe('trades');

        return () => {
          unsubTransactions();
          unsubTrades();
        };
      }, [uid, firestore]);

      return { data, loading, error, warnings };
    }
    ```
