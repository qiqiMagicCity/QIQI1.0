*   **纽约**: 2024-07-31 15:00:00 (America/New_York)
*   **UTC**: 2024-07-31 19:00:00 (UTC)

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
        const t = v.trim().replace(/,/g, ''); // ← 修复：去掉千位逗号
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

      const at = (raw.assetType ?? 'stock').toString().toLowerCase();
      const assetType: AssetType = (at === 'option' || at === 'options') ? 'option' : 'stock';

      const qtyNum = parseNumberLoose(raw.qty);
      const priceNum = parseNumberLoose(raw.price);
      if (qtyNum === null || priceNum === null) return null;

      // ← 新增：时间字段兼容映射
      const rawTsCandidate =
        (raw as any).transactionTimestamp ??
        (raw as any).timestamp ??
        (raw as any).ts ??
        (raw as any).time ??
        (raw as any).date ??
        (raw as any).transactionDate ??
        (raw as any).tradeDate ??
        null;

      const ts = parseTsToMillis(rawTsCandidate);
      if (ts === null) return null; // 关键字段缺失则跳过——符合 Rule 2.2

      const rawType = (raw.type || raw.action || (raw.side as any)) as TxType | string | undefined;
      const tLower = (rawType ?? (qtyNum >= 0 ? 'Buy' : 'Sell')).toString().toLowerCase();
      let side: Side;
      let qty = qtyNum;

      if (tLower.includes('sell') && !tLower.includes('cover')) {
        side = 'SELL';
        qty = -Math.abs(qty);
      } else {
        side = 'BUY';
        qty = Math.abs(qty);
      }

      const multiplier =
        typeof raw.multiplier === 'number'
          ? raw.multiplier
          : assetType === 'option'
          ? 100
          : 1;

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
              ws.push(`Failed to load 'transactions': ${lanes.transactions.err}`);
            }
            if (lanes.trades.err) {
              ws.push(`Failed to load 'trades': ${lanes.trades.err}`);
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
                  combined.set(`${col}-${d.id}`, norm);
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

*   **修改后 (新文件内容)**:
    ```ts
    'use client';

    import { useEffect, useState } from 'react';
    import {
      collection,
      query,
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
        const t = v.trim().replace(/,/g, ''); // ← 修复：去掉千位逗号
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

      const at = (raw.assetType ?? 'stock').toString().toLowerCase();
      const assetType: AssetType = (at === 'option' || at === 'options') ? 'option' : 'stock';

      const qtyNum = parseNumberLoose(raw.qty);
      const priceNum = parseNumberLoose(raw.price);
      if (qtyNum === null || priceNum === null) return null;

      // ← 新增：时间字段兼容映射
      const rawTsCandidate =
        (raw as any).transactionTimestamp ??
        (raw as any).timestamp ??
        (raw as any).ts ??
        (raw as any).time ??
        (raw as any).date ??
        (raw as any).transactionDate ??
        (raw as any).tradeDate ??
        null;

      const ts = parseTsToMillis(rawTsCandidate);
      if (ts === null) return null; // 关键字段缺失则跳过——符合 Rule 2.2

      const rawType = (raw.type || raw.action || (raw.side as any)) as TxType | string | undefined;
      const tLower = (rawType ?? (qtyNum >= 0 ? 'Buy' : 'Sell')).toString().toLowerCase();
      let side: Side;
      let qty = qtyNum;

      if (tLower.includes('sell') && !tLower.includes('cover')) {
        side = 'SELL';
        qty = -Math.abs(qty);
      } else {
        side = 'BUY';
        qty = Math.abs(qty);
      }

      const multiplier =
        typeof raw.multiplier === 'number'
          ? raw.multiplier
          : assetType === 'option'
          ? 100
          : 1;

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
              ws.push(`Failed to load 'transactions': ${lanes.transactions.err}`);
            }
            if (lanes.trades.err) {
              ws.push(`Failed to load 'trades': ${lanes.trades.err}`);
            }
            setWarnings(ws);
          }
        };

        const subscribe = (col: 'transactions' | 'trades') => {
          const ref = collection(firestore, 'users', uid, col);
          // No longer using orderBy in the query. Sorting is handled in updateState.
          return onSnapshot(ref,
            (snap) => {
              snap.docs.forEach((d) => {
                const raw = { id: d.id, ...d.data() } as FireTx;
                const norm = normalizeFireTx(raw, col);
                if (norm) {
                  combined.set(`${col}-${d.id}`, norm);
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
    