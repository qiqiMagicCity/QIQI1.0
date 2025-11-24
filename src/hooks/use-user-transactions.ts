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
export type Side = 'BUY' | 'SELL' | 'NOTE';
export type OpKind = 'BTO' | 'STO' | 'STC' | 'BTC' | 'BUY' | 'SELL' | 'SHORT' | 'COVER' | 'SPLIT';

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
  id: string; // The Firestore document ID.
  clientId?: string; // The original 'id' field from the document data, if it exists.
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
  right?: 'C' | 'P';
  strike?: number;
  expiry?: number;       // ms
  contractKey?: string;  // SYMBOL-RIGHT-STRIKE-YYYY-MM-DD（内部用去空格规范化的 SYMBOL）
}

function isFirestoreTimestamp(v: any): v is { toMillis: () => number } {
  return v && typeof v.toMillis === 'function';
}

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

// —— 新增：取嵌套路径的工具（支持 'a.b.c'）——
function getPath(obj: any, path: string) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}
// 覆盖 pickFirst：支持点路径
function pickFirst<T = any>(obj: any, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = k.includes('.') ? getPath(obj, k) : obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v as T;
  }
  return undefined;
}

const truthy = (v: any) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};
const occLike = (sym: string) => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/i.test(sym);


function parseLegacyCnUtcOffset(s: string): number | null {
  const m = s.trim().match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+UTC([+-]\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
  );
  if (!m) return null;
  const [, y, mo, d, off, hh, mm, ss, ms] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const offsetHours = Number(off), hour = Number(hh), minute = Number(mm);
  const second = ss ? Number(ss) : 0, millis = ms ? Number(ms.padEnd(3, '0')) : 0;
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


// ★★★ 修正版 normalizeFireTx：优先识别 type === 'SHORT' / 'COVER'（股票） ★★★
function normalizeFireTx(raw: FireTx, source: 'transactions' | 'trades'): Tx {
  const warnings: string[] = [];

  // symbol：顶层或 optionDetails.symbol
  const symbolRaw = pickFirst<string>(raw, ['symbol', 'ticker', 'underlying', 'symbolRoot', 'optionDetails.symbol']);
  const symbolClean = symbolRaw != null ? String(symbolRaw).trim() : '';
  const symbolUpper = symbolClean.toUpperCase();
  const symbol = symbolUpper || 'UNKNOWN';
  // —— 用于内部合约 key 的 symbol 规范化：去掉所有空格，统一大写 —— 
  const symbolForKey = symbolUpper.replace(/\s+/g, '');
  if (symbol === 'UNKNOWN') warnings.push('symbol_missing');

  // 资产类型：优先 assetType/securityType/instrumentType；其次 type=Option；再看 hints/multiplier/OCC
  const atCand = (pickFirst<any>(raw, ['assetType', 'securityType', 'instrumentType']) ?? '').toString().toLowerCase();
  let assetType: AssetType = atCand.includes('option') ? 'option' : 'stock';
  if (assetType === 'stock') {
    const tText = String(raw.type ?? '').toLowerCase();
    if (tText === 'option' || tText.includes('option')) assetType = 'option';
  }
  const m = typeof raw.multiplier === 'number' ? raw.multiplier : undefined;
  const optionHints =
    ['strike', 'strikePrice', 'expiry', 'expiration', 'expirationDate', 'putCall', 'right', 'optionType', 'optionSymbol']
      .some(k => raw[k as keyof FireTx] !== undefined)
    || ['optionDetails.strike', 'optionDetails.expiry', 'optionDetails.optionType']
      .some(p => pickFirst(raw, [p]) !== undefined);
  if (assetType === 'stock' && (optionHints || (m && m >= 100) || occLike(symbol))) assetType = 'option';
  const isOption = assetType === 'option';

  // 数量/价格：支持 optionDetails.* 别名
  const qtySrc = pickFirst<any>(raw, [
    'qty', 'quantity', 'shares', 'contracts', 'size', 'filledQty', 'filledQuantity', 'orderQty',
    'optionDetails.quantity'
  ]);
  const priceSrc = pickFirst<any>(raw, [
    'price', 'fillPrice', 'avgPrice', 'averagePrice', 'pricePerUnit', 'premium', 'tradePrice', 'executionPrice',
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
    'transactionTimestamp', 'timestamp', 'ts', 'time', 'date', 'transactionDate', 'tradeDate', 'optionDetails.tradeDate'
  ]) ?? pickFirst<any>(raw, ['optionDetails.expiry']);
  let ts = parseTsToMillis(rawTsCandidate);
  if (ts === null) { ts = 0; warnings.push('ts_unparsed'); }

  // 动作归一：从多字段/别名合流；期权优先 BTO/…；股票识别 SHORT/COVER
  const bag = [
    raw.type, raw.action, raw.side,
    (raw as any).operation, (raw as any).orderAction,
    (raw as any).positionEffect, (raw as any).openClose, (raw as any).effect,
  ].filter(Boolean).map(String).join('|').toLowerCase();

  // primary：优先从标准字段中提取一个“主动作”，用来强约束 type=SHORT/COVER 等
  const primaryRaw = pickFirst<any>(raw, ['type', 'action', 'side']);
  const primary = primaryRaw != null ? String(primaryRaw).trim().toUpperCase() : '';

  const bto = truthy((raw as any).buyToOpen) || /buy\s*to\s*open|bto/.test(bag);
  const btc = truthy((raw as any).buyToClose) || /buy\s*to\s*close|btc/.test(bag);
  const sto = truthy((raw as any).sellToOpen) || /sell\s*to\s*open|sto/.test(bag);
  const stc = truthy((raw as any).sellToClose) || /sell\s*to\s*close|stc/.test(bag);
  const shortSell = /short\s*sell/.test(bag) || truthy((raw as any).shortSell);
  const shortCover = /short\s*cover|cover/.test(bag) || truthy((raw as any).shortCover);

  let opKind: OpKind; let actionLabel: string; let side: Side; let qty: number;
  if (isOption) {
    if (bto) { opKind = 'BTO'; actionLabel = '买入'; side = 'BUY'; qty = Math.abs(qtyAbs); }
    else if (sto) { opKind = 'STO'; actionLabel = '卖空'; side = 'SELL'; qty = -Math.abs(qtyAbs); }
    else if (stc) { opKind = 'STC'; actionLabel = '卖出'; side = 'SELL'; qty = -Math.abs(qtyAbs); }
    else if (btc) { opKind = 'BTC'; actionLabel = '补回'; side = 'BUY'; qty = Math.abs(qtyAbs); }
    else if (/sell/.test(bag)) { opKind = 'STC'; actionLabel = '卖出'; side = 'SELL'; qty = -Math.abs(qtyAbs); }
    else if (/cover/.test(bag)) { opKind = 'BTC'; actionLabel = '补回'; side = 'BUY'; qty = Math.abs(qtyAbs); }
    else { opKind = 'BTO'; actionLabel = '买入'; side = 'BUY'; qty = Math.abs(qtyAbs); warnings.push('op_inferred_bto'); }
  } else {
    // 股票逻辑：先尊重标准化字段（primary），再回退到正则/兜底逻辑
    if (primary === 'SHORT') {
      // 手工录入或清洗后明确标记为 SHORT
      opKind = 'SHORT'; actionLabel = '卖空'; side = 'SELL'; qty = -Math.abs(qtyAbs);
    } else if (primary === 'COVER' || primary === 'SHORT COVER' || primary === 'BUY TO COVER') {
      opKind = 'COVER'; actionLabel = '补回'; side = 'BUY'; qty = Math.abs(qtyAbs);
    } else if (shortSell) {
      opKind = 'SHORT'; actionLabel = '卖空'; side = 'SELL'; qty = -Math.abs(qtyAbs);
    } else if (shortCover) {
      opKind = 'COVER'; actionLabel = '补回'; side = 'BUY'; qty = Math.abs(qtyAbs);
    } else if (/sell/.test(bag)) {
      opKind = 'SELL'; actionLabel = '卖出'; side = 'SELL'; qty = -Math.abs(qtyAbs);
    } else if (primary === 'SPLIT' || primary === 'STOCK SPLIT' || /split/.test(bag)) {
      opKind = 'SPLIT'; actionLabel = '拆分'; side = 'NOTE'; qty = 0; // Ignore qty for PnL
    } else {
      opKind = 'BUY'; actionLabel = '买入'; side = 'BUY'; qty = Math.abs(qtyAbs);
    }
  }

  // —— 提取期权细节（多别名 + optionDetails.*）——
  const rightRaw = (pickFirst<any>(raw, ['putCall', 'right', 'optionType', 'optionDetails.optionType']) ?? '').toString().toUpperCase();
  const right = rightRaw.startsWith('P') ? 'P' : (rightRaw.startsWith('C') ? 'C' : undefined);

  const strikeNum = parseNumberLoose(pickFirst<any>(raw, ['strike', 'strikePrice', 'optionDetails.strike']) ?? '');
  const strike = strikeNum === null ? undefined : strikeNum;

  const expiryMs = parseTsToMillis(pickFirst<any>(raw, ['expiry', 'expiration', 'expirationDate', 'optionDetails.expiry']) ?? '');
  const expiry = expiryMs === null ? undefined : expiryMs;

  let contractKey: string | undefined;
  if (isOption && symbol !== 'UNKNOWN' && right && typeof strike === 'number' && typeof expiry === 'number') {
    const ymd = new Date(expiry).toISOString().slice(0, 10);
    const baseSymbolForKey = symbolForKey || symbol;
    // 注意：这里用去空格的大写 symbolForKey，避免同一合约因空格差异无法配对
    contractKey = `${baseSymbolForKey}-${right}-${strike}-${ymd}`;
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
    right, strike, expiry, contractKey
  };
}

function deriveOptionEffects(list: Tx[]): Tx[] {
  // 按时间升序扫一遍，每个 contractKey 维护净仓位
  const posByKey = new Map<string, number>();
  const asc = [...list].sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

  for (const tx of asc) {
    if (!tx.isOption) continue;
    const key = tx.contractKey || `UL:${tx.symbol}`; // 没细节时退化到标的级
    const prev = posByKey.get(key) ?? 0;

    // 仅当来源记录未显式给出 STC/BTC/STO/BTO 或带有推断警告时，才做推断覆盖
    const needsGuess =
      tx.warnings.includes('op_inferred_bto') ||
      (tx.opKind === 'BUY' || tx.opKind === 'SELL' || !tx.opKind);

    if (needsGuess) {
      if (tx.qty > 0) {
        // 买：若之前净仓位 < 0 → 回补(BTC)，否则开仓(BTO)
        tx.opKind = prev < 0 ? 'BTC' : 'BTO';
        tx.actionLabel = prev < 0 ? '补回' : '买入';
      } else if (tx.qty < 0) {
        // 卖：若之前净仓位 > 0 → 平仓(STC)，否则开空(STO)
        tx.opKind = prev > 0 ? 'STC' : 'STO';
        tx.actionLabel = prev > 0 ? '卖出' : '卖空';
      }
      tx.warnings = tx.warnings.filter(w => w !== 'op_inferred_bto');
    }

    posByKey.set(key, prev + tx.qty); // 更新净仓位
  }
  return list;
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
      let allTransactions = Array.from(combined.values());
      // 先做期权开/平自动推断，顺带移除 op_inferred_bto
      allTransactions = deriveOptionEffects(allTransactions);

      const allWarnings: string[] = [];

      allTransactions.forEach((tx) => {
        if (tx.warnings.length > 0) {
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
          for (const change of snap.docChanges()) {
            const d = change.doc;
            const key = `${col}-${d.id}`;

            if (change.type === 'removed') {
              combined.delete(key);
              continue;
            }

            // For 'added' or 'modified'
            const data = d.data();
            const raw = { ...data, id: d.id } as FireTx;
            const norm = normalizeFireTx(raw, col);

            if (norm) {
              if (data.id) {
                (norm as any).clientId = data.id;
              }
              combined.set(key, norm);
            } else {
              // If normalization fails, ensure old data is not left behind.
              combined.delete(key);
            }
          }
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
