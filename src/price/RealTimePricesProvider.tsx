'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useFirestore } from '@/firebase';
import { nyWeekdayIndex, toNyCalendarDayString, toNyHmsString } from '@/lib/ny-time';

type RtStatus = 'live' | 'stale' | 'closed' | 'pending' | 'error';

export type PriceRecord = { price: number | null; ts: number; status: RtStatus };

type PriceCenterCtx = {
  /** 读取某个代码的当前记录（包含 price/ts/status） */
  get(symbol: string): PriceRecord | undefined;
  /** 当前全量价格表（调试/批量使用） */
  map: Map<string, PriceRecord>;
  /** 注册一个消费者的订阅符号集（自动合并为全局观察集） */
  register(consumerId: string, symbols: string[]): void;
  /** 取消注册 */
  unregister(consumerId: string): void;
};

const PriceCenterContext = createContext<PriceCenterCtx | null>(null);

const FRESHNESS_MS = 15_000;         // 实时价新鲜阈值 15s
const QUEUE_GAP_MS = 7_000;          // 队列间隔 ≥7s（GLOBAL_RULES 约束）
const TIMEOUT_MS   = 6_000;          // 拉价超时，降级为 stale
const CACHE_TTL_MS = 60_000;         // 主动拉价缓存有效期 60s

// 2025/2026 交易日假期表（与 use-holdings 对齐）
const US_MARKET_HOLIDAYS = new Set<string>([
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
]);

function getMarketSession(now: Date): 'pre'|'open'|'post'|'closed' {
  const wd = nyWeekdayIndex(now);
  const d = toNyCalendarDayString(now);
  if (wd === 0 || wd === 6 || US_MARKET_HOLIDAYS.has(d)) return 'closed';
  const [hh, mm, ss] = toNyHmsString(now).split(':').map(n => parseInt(n, 10));
  const t = hh * 3600 + mm * 60 + ss;
  const PRE_OPEN = 4*3600;
  const OPEN     = 9*3600 + 30*60;
  const CLOSE    = 16*3600;
  const POST_END = 20*3600;
  if (t >= OPEN && t < CLOSE) return 'open';
  if (t >= PRE_OPEN && t < OPEN) return 'pre';
  if (t >= CLOSE && t < POST_END) return 'post';
  return 'closed';
}

export const RealTimePricesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const firestore = useFirestore();
  const functions = useMemo(() => getFunctions(undefined, 'us-central1'), []);
  const priceQuote = useMemo(() => httpsCallable(functions, 'priceQuote'), [functions]);

  // === 全局价格表（唯一真相） ===
  const [mapState, setMapState] = useState<Map<string, PriceRecord>>(new Map());
  const mapRef = useRef(mapState);
  mapRef.current = mapState;

  // === 消费者订阅集合：合并成全局观测符号集 ===
  const consumers = useRef<Map<string, Set<string>>>(new Map());
  const observed  = useRef<Set<string>>(new Set());

  const recomputeObserved = () => {
    const s = new Set<string>();
    for (const set of consumers.current.values()) {
      for (const sym of set) s.add(sym);
    }
    observed.current = s;
  };

  const register = useCallback((id: string, symbols: string[]) => {
    consumers.current.set(id, new Set(symbols.filter(Boolean)));
    recomputeObserved();
  }, []);

  const unregister = useCallback((id: string) => {
    consumers.current.delete(id);
    recomputeObserved();
  }, []);

  const get = useCallback((symbol: string) => mapRef.current.get(symbol), []);

  // === Firestore 被动订阅（不受队列限制） ===
  useEffect(() => {
    if (!firestore) return;
    const unsubs: Unsubscribe[] = [];
    const seen = new Set<string>();

    for (const symbol of observed.current) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      const ref = doc(firestore, 'stockDetails', symbol);
      const u = onSnapshot(ref, snap => {
        if (!snap.exists()) return;
        const data: any = snap.data();
        const price = (data?.last ?? data?.close ?? null) as number | null;
        if (price === undefined) return;
        const rec: PriceRecord = {
          price,
          ts: Date.now(),
          status: deriveStatus(price, Date.now()),
        };
        setMapState(prev => {
          const next = new Map(prev);
          next.set(symbol, rec);
          return next;
        });
      });
      unsubs.push(u);
    }
    return () => { unsubs.forEach(u => u()); };
    // 依赖 observed 的内容变化，但 observed.current 是 ref；我们用定时器轮询合并以减少抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, observed.current.size]);

  // === 单队列主动拉价：≥7s，盘中才运行；超时降级为 stale，绝不并发 ===
  useEffect(() => {
    let cancelled = false;
    let timer: any = null;
    let idx = 0;
    const symbols = () => Array.from(observed.current);

    const tick = async () => {
      if (cancelled) return;
      const now = new Date();
      const sess = getMarketSession(now);
      if (sess !== 'open') {
        // 非盘中：标记 closed，不主动拉
        setMapState(prev => {
          const next = new Map(prev);
          for (const s of symbols()) {
            const prevRec = next.get(s);
            if (prevRec) next.set(s, { ...prevRec, status: 'closed' });
          }
          return next;
        });
        timer = setTimeout(tick, QUEUE_GAP_MS);
        return;
      }

      const syms = symbols();
      if (syms.length === 0) {
        timer = setTimeout(tick, QUEUE_GAP_MS);
        return;
      }

      const s = syms[idx % syms.length]; // 单请求轮询
      idx++;

      // 缓存新鲜就跳过主动拉
      const existing = mapRef.current.get(s);
      if (existing && Date.now() - existing.ts < CACHE_TTL_MS) {
        timer = setTimeout(tick, QUEUE_GAP_MS);
        return;
      }

      // 拉价（带超时）
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const result: any = await priceQuote({ symbol: s, signal: controller.signal });
        const price = (result?.data as any)?.price as number | null;
        const rec: PriceRecord = {
          price: price ?? existing?.price ?? null,
          ts: Date.now(),
          status: deriveStatus(price ?? existing?.price ?? null, Date.now()),
        };
        setMapState(prev => {
          const next = new Map(prev);
          next.set(s, rec);
          return next;
        });
      } catch (_err) {
        // 超时/失败：使用上次有效价 + stale
        const prev = mapRef.current.get(s);
        const rec: PriceRecord = {
          price: prev?.price ?? null,
          ts: prev?.ts ?? Date.now(),
          status: prev?.price != null ? 'stale' : 'error',
        };
        setMapState(prevMap => {
          const next = new Map(prevMap);
          next.set(s, rec);
          return next;
        });
      } finally {
        clearTimeout(to);
        timer = setTimeout(tick, QUEUE_GAP_MS);
      }
    };

    timer = setTimeout(tick, 0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [priceQuote]);

  const value = useMemo<PriceCenterCtx>(() => ({
    get,
    map: mapRef.current,
    register,
    unregister,
  }), [get, register, unregister]);

  return (
    <PriceCenterContext.Provider value={value}>
      {children}
    </PriceCenterContext.Provider>
  );
};

function deriveStatus(price: number | null, ts: number): RtStatus {
  const now = Date.now();
  const sess = getMarketSession(new Date());
  if (sess === 'closed') return 'closed';
  if (price == null)     return sess === 'open' ? 'pending' : 'closed';
  if (sess === 'open')   return (now - ts) > FRESHNESS_MS ? 'stale' : 'live';
  return 'closed';
}

export function usePriceCenterContext(): PriceCenterCtx {
  const ctx = useContext(PriceCenterContext);
  if (!ctx) throw new Error('RealTimePricesProvider is missing');
  return ctx;
}
