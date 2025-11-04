*   **纽约**: 2024-08-01 11:30:00 (America/New_York)
*   **UTC**: 2024-08-01 15:30:00 (UTC)

---

#### **1. 修改文件： `src/hooks/use-user-transactions.ts`**

*   **修改前**:
    ```tsx
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
    export type OpKind = 'BTO'|'STO'|'STC'|'BTC'|'BUY'|'SELL'|'SHORT'|'COVER';

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
      [key: string]: any; // Allow other properties for alias checking
    }

    // Clean, normalized type for use in the app
    export interface Tx {
      id: string;
      symbol: string;
      assetType: AssetType;
      type: TxType;
      side: Side;
      qty: number;
      price: number;
      multiplier: number; // stock=1, option=100
      transactionTimestamp: number;
      source: 'transactions' | 'trades';
      warnings: string[];
      opKind: OpKind;         // 统一后的操作种类
      actionLabel: string;    // 中文：买入/卖出/卖空/补回
      isOption: boolean;      // 期权标记
    }

    function isFirestoreTimestamp(v: any): v is { toMillis: () => number } {
      return v && typeof v.toMillis === 'function';
    }

    function parseNumberLoose(v: unknown): number | null {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const t = v.trim().replace(/,/g, '');
        if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          return Number.isFinite(n) ? n : null;
        }
      }
      return null;
    }

    function parseLegacyCnUtcOffset(s: string): number | null {
      const m = s.trim().match(
        /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+UTC([+-]\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
      );
      if (!m) return null;
      const [, y, mo, d, off, hh, mm, ss] = m;
      const year = Number(y);
      const month = Number(mo);
      const day = Number(d);
      const offsetHours = Number(off);
      const hour = Number(hh);
      const minute = Number(mm);
      const second = ss ? Number(ss) : 0;

      if (
        !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
        !Number.isFinite(offsetHours) || !Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)
      ) return null;

      const ms = Date.UTC(year, month - 1, day, hour - offsetHours, minute, second);
      return Number.isFinite(ms) ? ms : null;
    }


    function parseTsToMillis(v: unknown): number | null {
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
      }
      if (isFirestoreTimestamp(v)) {
        const n = v.toMillis();
        return Number.isFinite(n) ? n : null;
      }
      if (typeof v === 'string') {
        const t = v.trim();
        if (/^\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
        }
        const d = Date.parse(t);
        if (Number.isFinite(d)) return d;
        
        const legacy = parseLegacyCnUtcOffset(t);
        if (legacy !== null) return legacy;
      }
      return null;
    }

    const truthy = (v: any) => {
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes';
    };
    const occLike = (sym: string) => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/i.test(sym);

    function normalizeFireTx(raw: FireTx, source: 'transactions' | 'trades'): Tx {
      const localWarnings: string[] = [];

      const symbol = raw.symbol?.trim()?.toUpperCase() || 'UNKNOWN';
      if (symbol === 'UNKNOWN') {
        localWarnings.push('symbol_missing');
      }
      
      const at = (raw.assetType ?? 'stock').toString().toLowerCase();
      let assetType: AssetType = (at === 'option' || at === 'options') ? 'option' : 'stock';

      const m = typeof raw.multiplier === 'number' ? raw.multiplier : undefined;
      if (assetType === 'stock' && (m && m >= 100 || occLike(symbol))) assetType = 'option';
      const isOption = assetType === 'option';

      const qtyNum = parseNumberLoose(raw.qty);
      const priceNum = parseNumberLoose(raw.price);
      const qtyAbs = qtyNum ?? 0;
      const priceVal = priceNum ?? 0;
      if (qtyNum === null) localWarnings.push('qty_unparsed');
      if (priceNum === null) localWarnings.push('price_unparsed');

      const rawTsCandidate =
        (raw as any).transactionTimestamp ??
        (raw as any).timestamp ??
        (raw as any).ts ??
        (raw as any).time ??
        (raw as any).date ??
        (raw as any).transactionDate ??
        (raw as any).tradeDate ??
        null;

      let ts = parseTsToMillis(rawTsCandidate);
      if (ts === null) {
        ts = 0; // Fallback for sorting
        localWarnings.push('ts_unparsed');
      }

      const rawType = (raw.type || raw.action || (raw.side as any)) as TxType | string | undefined;
      const tLower = (rawType ?? (qtyAbs >= 0 ? 'Buy' : 'Sell')).toString().toLowerCase();
      let side: Side;
      let qty = qtyAbs;

      if (tLower.includes('sell') && !tLower.includes('cover')) {
        side = 'SELL';
        qty = -Math.abs(qtyAbs);
      } else {
        side = 'BUY';
        qty = Math.abs(qtyAbs);
      }
      const bag = [
        raw.type, raw.action, raw.side,
        (raw as any).operation, (raw as any).orderAction,
        (raw as any).positionEffect, (raw as any).openClose, (raw as any).effect,
      ].filter(Boolean).map(String);
      const s = bag.join('|').toLowerCase();

      const bto = truthy((raw as any).buyToOpen)  || /buy\s*to\s*open|bto/.test(s);
      const btc = truthy((raw as any).buyToClose) || /buy\s*to\s*close|btc/.test(s);
      const sto = truthy((raw as any).sellToOpen) || /sell\s*to\s*open|sto/.test(s);
      const stc = truthy((raw as any).sellToClose)|| /sell\s*to\s*close|stc/.test(s);

      const shortSell = /short\s*sell/.test(s) || truthy((raw as any).shortSell);
      const shortCover= /short\s*cover|cover/.test(s) || truthy((raw as any).shortCover);

      let opKind: OpKind; let actionLabel: string;

      if (isOption) {
        if (bto)      { opKind='BTO'; actionLabel='买入'; side='BUY';  qty= Math.abs(qtyAbs); }
        else if (sto) { opKind='STO'; actionLabel='卖空'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (stc) { opKind='STC'; actionLabel='卖出'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (btc) { opKind='BTC'; actionLabel='补回'; side='BUY';  qty= Math.abs(qtyAbs); }
        else if (/sell/.test(s)) { opKind='STC'; actionLabel='卖出'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (/cover/.test(s)){ opKind='BTC'; actionLabel='补回'; side='BUY';  qty= Math.abs(qtyAbs); }
        else { opKind='BTO'; actionLabel='买入'; side='BUY'; qty=Math.abs(qtyAbs); localWarnings.push('op_inferred_bto'); }
      } else {
        if (shortSell){ opKind='SHORT'; actionLabel='卖空'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (shortCover){ opKind='COVER'; actionLabel='补回'; side='BUY'; qty=Math.abs(qtyAbs); }
        else if (/sell/.test(s)){ opKind='SELL'; actionLabel='卖出'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else { opKind='BUY'; actionLabel='买入'; side='BUY'; qty=Math.abs(qtyAbs); }
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
        price: priceVal,
        multiplier,
        transactionTimestamp: ts,
        source,
        warnings: localWarnings,
        opKind,
        actionLabel,
        isOption,
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
          const allTransactions = Array.from(combined.values());
          const allWarnings: string[] = [];
          
          allTransactions.forEach((tx) => {
            if(tx.warnings.length > 0) {
              allWarnings.push(`[${tx.source}-${tx.id}]: ${tx.warnings.join(', ')}`);
            }
          });
          
          setData(allTransactions.sort((a, b) => b.transactionTimestamp - a.transactionTimestamp));

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
            setWarnings([...ws, ...allWarnings]);
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
    ```

*   **修改后 (新文件内容)**:
    ```tsx
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
    export type OpKind = 'BTO'|'STO'|'STC'|'BTC'|'BUY'|'SELL'|'SHORT'|'COVER';

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
      [key: string]: any; // Allow other properties for alias checking
    }

    // Clean, normalized type for use in the app
    export interface Tx {
      id: string;
      symbol: string;
      assetType: AssetType;
      type: TxType;
      side: Side;
      qty: number;
      price: number;
      multiplier: number; // stock=1, option=100
      transactionTimestamp: number;
      source: 'transactions' | 'trades';
      warnings: string[];
      opKind: OpKind;         // 统一后的操作种类
      actionLabel: string;    // 中文：买入/卖出/卖空/补回
      isOption: boolean;      // 期权标记
    }

    function isFirestoreTimestamp(v: any): v is { toMillis: () => number } {
      return v && typeof v.toMillis === 'function';
    }

    // 覆盖：更强的数字解析
    function parseNumberLoose(v: unknown): number | null {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        // 去千分位，统一 Unicode 负号，去空格，支持括号负数
        let t = v.trim().replace(/\u2212/g, '-').replace(/[, \u00A0]/g, '');
        const neg = /^\(.*\)$/.test(t);
        t = t.replace(/[()]/g, '');
        if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          if (!Number.isFinite(n)) return null;
          return neg ? -Math.abs(n) : n;
        }
      }
      return null;
    }

    // 新增：取嵌套路径
    function getPath(obj: any, path: string) {
      return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
    }
    
    // 覆盖：支持点路径
    function pickFirst<T = any>(obj: any, keys: string[]): T | undefined {
      for (const k of keys) {
        const v = k.includes('.') ? getPath(obj, k) : obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v as T;
      }
      return undefined;
    }

    // 覆盖：支持毫秒
    function parseLegacyCnUtcOffset(s: string): number | null {
      const m = s.trim().match(
        /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+UTC([+-]\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
      );
      if (!m) return null;
      const [, y, mo, d, off, hh, mm, ss, ms] = m;
      const year = Number(y), month = Number(mo), day = Number(d);
      const offsetHours = Number(off), hour = Number(hh), minute = Number(mm);
      const second = ss ? Number(ss) : 0, millis = ms ? Number(ms.padEnd(3,'0')) : 0;
      const t = Date.UTC(year, month - 1, day, hour - offsetHours, minute, second, millis);
      return Number.isFinite(t) ? t : null;
    }

    function parseTsToMillis(v: unknown): number | null {
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
      }
      if (isFirestoreTimestamp(v)) {
        const n = v.toMillis();
        return Number.isFinite(n) ? n : null;
      }
      if (typeof v === 'string') {
        const t = v.trim();
        if (/^\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
        }
        const d = Date.parse(t);
        if (Number.isFinite(d)) return d;
        
        const legacy = parseLegacyCnUtcOffset(t);
        if (legacy !== null) return legacy;
      }
      return null;
    }


    // ★★★ 用这版完整覆盖你的 normalizeFireTx ★★★
    function normalizeFireTx(raw: FireTx, source: 'transactions' | 'trades'): Tx {
      const warnings: string[] = [];

      // symbol：顶层或 optionDetails.symbol
      const symbolRaw = pickFirst<string>(raw, ['symbol','ticker','underlying','symbolRoot','optionDetails.symbol']);
      const symbol = symbolRaw?.trim()?.toUpperCase() || 'UNKNOWN';
      if (symbol === 'UNKNOWN') warnings.push('symbol_missing');

      // 资产类型：优先 assetType/securityType/instrumentType；其次 type=Option；再看 hints/multiplier/OCC
      const atCand = (pickFirst<any>(raw, ['assetType','securityType','instrumentType']) ?? '').toString().toLowerCase();
      let assetType: AssetType = atCand.includes('option') ? 'option' : 'stock';
      if (assetType === 'stock') {
        const tText = String(raw.type ?? '').toLowerCase();
        if (tText === 'option' || tText.includes('option')) assetType = 'option';
      }
      const m = typeof raw.multiplier === 'number' ? raw.multiplier : undefined;
      const optionHints =
        ['strike','strikePrice','expiry','expiration','expirationDate','putCall','right','optionType','optionSymbol']
          .some(k => raw[k as keyof FireTx] !== undefined)
        || ['optionDetails.strike','optionDetails.expiry','optionDetails.optionType']
          .some(p => pickFirst(raw,[p]) !== undefined);
      const occLike = (sym: string) => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/i.test(sym);
      if (assetType === 'stock' && (optionHints || (m && m >= 100) || occLike(symbol))) assetType = 'option';
      const isOption = assetType === 'option';

      // 数量/价格：支持 optionDetails.* 别名
      const qtySrc = pickFirst<any>(raw, [
        'qty','quantity','shares','contracts','size','filledQty','filledQuantity','orderQty',
        'optionDetails.quantity'
      ]);
      const priceSrc = pickFirst<any>(raw, [
        'price','fillPrice','avgPrice','averagePrice','pricePerUnit','premium','tradePrice','executionPrice',
        'optionDetails.price'
      ]);
      const qtyNum = parseNumberLoose(qtySrc);
      const priceNum = parseNumberLoose(priceSrc);
      const qtyAbs = qtyNum ?? 0;
      const priceVal = priceNum ?? 0;
      if (qtyNum === null) warnings.push('qty_unparsed');
      if (priceNum === null) warnings.push('price_unparsed');

      // 时间：含 tradeDate 与 optionDetails.expiry（备用）
      const rawTsCandidate = pickFirst<any>(raw, [
        'transactionTimestamp','timestamp','ts','time','date','transactionDate','tradeDate','optionDetails.tradeDate'
      ]) ?? pickFirst<any>(raw, ['optionDetails.expiry']);
      let ts = parseTsToMillis(rawTsCandidate);
      if (ts === null) { ts = 0; warnings.push('ts_unparsed'); }

      // 动作归一：从多字段/别名合流；期权优先 BTO/…；股票识别 SHORT/COVER
      const bag = [
        raw.type, raw.action, raw.side,
        (raw as any).operation, (raw as any).orderAction,
        (raw as any).positionEffect, (raw as any).openClose, (raw as any).effect,
      ].filter(Boolean).map(String).join('|').toLowerCase();

      const truthy = (v: any) => { const s = String(v ?? '').trim().toLowerCase(); return s==='true'||s==='1'||s==='yes'; };
      const bto = truthy((raw as any).buyToOpen)  || /buy\s*to\s*open|bto/.test(bag);
      const btc = truthy((raw as any).buyToClose) || /buy\s*to\s*close|btc/.test(bag);
      const sto = truthy((raw as any).sellToOpen) || /sell\s*to\s*open|sto/.test(bag);
      const stc = truthy((raw as any).sellToClose)|| /sell\s*to\s*close|stc/.test(bag);
      const shortSell  = /short\s*sell/.test(bag) || truthy((raw as any).shortSell);
      const shortCover = /short\s*cover|cover/.test(bag) || truthy((raw as any).shortCover);

      let opKind: OpKind; let actionLabel: string; let side: Side; let qty: number;
      if (isOption) {
        if (bto)      { opKind='BTO'; actionLabel='买入'; side='BUY';  qty= Math.abs(qtyAbs); }
        else if (sto) { opKind='STO'; actionLabel='卖空'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (stc) { opKind='STC'; actionLabel='卖出'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (btc) { opKind='BTC'; actionLabel='补回'; side='BUY';  qty= Math.abs(qtyAbs); }
        else if (/sell/.test(bag)) { opKind='STC'; actionLabel='卖出'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (/cover/.test(bag)){ opKind='BTC'; actionLabel='补回'; side='BUY';  qty= Math.abs(qtyAbs); }
        else { opKind='BTO'; actionLabel='买入'; side='BUY'; qty=Math.abs(qtyAbs); warnings.push('op_inferred_bto'); }
      } else {
        if (shortSell)      { opKind='SHORT'; actionLabel='卖空'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else if (shortCover){ opKind='COVER'; actionLabel='补回'; side='BUY';  qty= Math.abs(qtyAbs); }
        else if (/sell/.test(bag)) { opKind='SELL'; actionLabel='卖出'; side='SELL'; qty=-Math.abs(qtyAbs); }
        else { opKind='BUY'; actionLabel='买入'; side='BUY'; qty=Math.abs(qtyAbs); }
      }

      const multiplier = typeof raw.multiplier === 'number' ? raw.multiplier : (isOption ? 100 : 1);
      const typeLabel = (raw.type as any) ?? actionLabel;

      return {
        id: raw.id,
        symbol,
        assetType,
        isOption,
        type: typeLabel as any,
        opKind,
        actionLabel,
        side,
        qty,
        price: priceVal,
        multiplier,
        transactionTimestamp: ts,
        source,
        warnings,
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
          const allTransactions = Array.from(combined.values());
          const allWarnings: string[] = [];
          
          allTransactions.forEach((tx) => {
            if(tx.warnings.length > 0) {
              allWarnings.push(`[${tx.source}-${tx.id}]: ${tx.warnings.join(', ')}`);
            }
          });
          
          setData(allTransactions.sort((a, b) => b.transactionTimestamp - a.transactionTimestamp));

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
            setWarnings([...ws, ...allWarnings]);
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
    ```
