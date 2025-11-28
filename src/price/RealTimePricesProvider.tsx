'use client';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/provider';
import { nyWeekdayIndex, toNyCalendarDayString, toNyHmsString } from '@/lib/ny-time';

// 实时价格状态 RtStatus（实时状态枚举）：用于标记价格的新鲜程度和会话状态
type RtStatus = 'live' | 'stale' | 'closed' | 'pending' | 'error';

/** PriceRecord（价格记录）：price=价格，ts=时间戳 timestamp，status=状态标签 */
export type PriceRecord = { price: number | null; ts: number; status: RtStatus };

/** PriceCenterCtx（价格中心上下文）：对外暴露的统一接口 */
type PriceCenterCtx = {
  /** 读取某个代码的当前记录（包含 price/ts/status） */
  get(symbol: string): PriceRecord | undefined;
  /** 当前全量价格表（调试/批量使用） */
  map: Map<string, PriceRecord>;
  /** 注册一个消费者的订阅符号集（自动合并为全局观察集） */
  register(consumerId: string, symbols: string[]): void;
  /** 取消注册 */
  unregister(consumerId: string): void;
  /** 当前正在拉取的股票代码（用于 UI 显示 loading 态） */
  fetchingSymbol: string | null;
};

const PriceCenterContext = createContext<PriceCenterCtx | null>(null);

const FRESHNESS_MS = 60_000;   // 实时价新鲜阈值 60s（毫秒）
const QUEUE_GAP_MS = 7_000;    // 队列间隔 ≥7s（遵守全局规则）
const TIMEOUT_MS = 6_000;    // 拉价超时（HTTP 超时）
const CACHE_TTL_MS = 60_000;   // 主动拉价缓存有效期 60s

// 2025/2026 交易日假期表（与 use-holdings 对齐）
const US_MARKET_HOLIDAYS = new Set<string>([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

// 根据当前纽约时间判断市场会话（pre/open/post/closed）
function getMarketSession(now: Date): 'pre' | 'open' | 'post' | 'closed' {
  const wd = nyWeekdayIndex(now);
  const d = toNyCalendarDayString(now);
  if (wd === 0 || wd === 6 || US_MARKET_HOLIDAYS.has(d)) return 'closed';

  const [hh, mm, ss] = toNyHmsString(now).split(':').map(n => parseInt(n, 10));
  const t = hh * 3600 + mm * 60 + ss;

  const PRE_OPEN = 4 * 3600;
  const OPEN = 9 * 3600 + 30 * 60;
  const CLOSE = 16 * 3600;
  const POST_END = 20 * 3600;

  if (t >= OPEN && t < CLOSE) return 'open';
  if (t >= PRE_OPEN && t < OPEN) return 'pre';
  if (t >= CLOSE && t < POST_END) return 'post';
  return 'closed';
}

export const RealTimePricesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const functions = useMemo(() => getFunctions(undefined, 'us-central1'), []);
  const priceQuote = useMemo(() => httpsCallable(functions, 'priceQuote'), [functions]);

  // === 全局价格表（唯一真相，SSOT = single source of truth 单一事实来源） ===
  const [mapState, setMapState] = useState<Map<string, PriceRecord>>(new Map());
  const mapRef = useRef(mapState);
  mapRef.current = mapState;

  // === 消费者订阅集合：合并成全局观测符号集 ===
  const consumers = useRef<Map<string, Set<string>>>(new Map());
  const observed = useRef<Set<string>>(new Set());
  // 观察集合版本号（用于触发订阅 effect 重新执行）
  const [observedVer, setObservedVer] = useState(0);

  // === 当前正在拉取的 Symbol ===
  const [fetchingSymbol, setFetchingSymbol] = useState<string | null>(null);

  const recomputeObserved = () => {
    const s = new Set<string>();
    for (const set of consumers.current.values()) {
      for (const sym of set) s.add(sym);
    }
    observed.current = s;
    // 让依赖 observedVer 的订阅 effect 重跑
    setObservedVer(v => v + 1);
  };

  const register = useCallback((id: string, symbols: string[]) => {
    consumers.current.set(id, new Set(symbols.filter(Boolean)));
    recomputeObserved();
  }, []);

  const unregister = useCallback((id: string) => {
    consumers.current.delete(id);
    recomputeObserved();
  }, []);

  /** 读取价格：始终从最新的 mapRef.current 中取值 */
  const get = useCallback((symbol: string) => mapRef.current.get(symbol), []);

  // === Firestore 被动订阅（不受轮询队列限制） ===
  useEffect(() => {
    if (isUserLoading || !user) return; // 必须登录
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
        const last = data?.last;

        // 只接受合法的数值型 last（常规盘最后一笔成交价），不再用 close 等字段兜底
        if (typeof last !== 'number' || !Number.isFinite(last)) {
          // 没有合法 last：保持现有价格记录不变，宁可不更新，也不乱写
          return;
        }

        const price = last as number;
        const nowTs = Date.now();

        const rec: PriceRecord = {
          price,
          ts: nowTs,
          status: deriveStatus(price, nowTs),
        };

        setMapState(prev => {
          const old = prev.get(symbol);
          if (old && old.price === price && old.status === rec.status) {
            return prev; // No change, skip render
          }
          const next = new Map(prev);
          next.set(symbol, rec);
          return next;
        });
      });

      unsubs.push(u);
    }

    return () => {
      unsubs.forEach(u => u());
    };
  }, [firestore, observedVer, user, isUserLoading]);

  // === 单队列主动拉价（API 跨网调用）：≥7s；绝不并发 ===
  useEffect(() => {
    if (isUserLoading || !user) return; // 必须登录

    let cancelled = false;
    let timer: any = null;
    let idx = 0;

    const symbols = () => Array.from(observed.current);

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ]);

    const tick = async () => {
      if (cancelled) return;

      const syms = symbols();
      if (syms.length === 0) {
        timer = setTimeout(tick, QUEUE_GAP_MS);
        return;
      }

      const s = syms[idx % syms.length]; // 单请求轮询
      idx++;

      // 缓存新鲜（TTL）就跳过主动拉（减少 API 压力）
      const existing = mapRef.current.get(s);
      if (existing && Date.now() - existing.ts < CACHE_TTL_MS) {
        timer = setTimeout(tick, 100);
        return;
      }

      // 开始拉取：设置 fetchingSymbol
      setFetchingSymbol(s);

      try {
        // 仅传纯 JSON，并做本地超时
        const result: any = await withTimeout(
          priceQuote({ symbol: s }) as Promise<any>,
          TIMEOUT_MS,
        );

        const price = (result?.data as any)?.price as number | null;
        const nowTs = Date.now();

        if (price != null) {
          // 成功拿到新价格：更新价格 + 时间戳 + 状态
          const rec: PriceRecord = {
            price: price,
            ts: nowTs,
            status: deriveStatus(price, nowTs),
          };

          setMapState(prev => {
            const old = prev.get(s);
            if (old && old.price === price && old.status === rec.status) {
              return prev;
            }
            const next = new Map(prev);
            next.set(s, rec);
            return next;
          });
        } else {
          // API 返回 null (失败/无数据)：保持原有价格，但标记为 stale (或者保持原有状态)
          // 绝对不能更新 ts 为 nowTs，否则会掩盖数据陈旧的事实！
          const prev = mapRef.current.get(s);
          const rec: PriceRecord = {
            price: prev?.price ?? null,
            ts: prev?.ts ?? Date.now(), // 保持原有时间戳
            status: prev?.price != null ? 'stale' : 'error',
          };

          setMapState(prevMap => {
            const next = new Map(prevMap);
            next.set(s, rec);
            return next;
          });
        }
      } catch (_err) {
        // 超时/失败：使用上次有效价 + stale（待刷新）
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
        // 结束拉取：清除 fetchingSymbol
        setFetchingSymbol(null);
        timer = setTimeout(tick, QUEUE_GAP_MS);
      }
    };

    timer = setTimeout(tick, 0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [priceQuote, user, isUserLoading]);

  /**
   * 注意这里的关键点：
   * - map 对外暴露用 mapState（有状态更新），不是 mapRef.current；
   * - useMemo 把 mapState 放进依赖里。
   * 这样每次价格表更新，Context（上下文）的 value 引用都会变化，
   * 使用 usePriceCenterContext 的下游组件会被 React 通知“有更新”。
   */
  const value = useMemo<PriceCenterCtx>(() => ({
    get,
    map: mapState,
    register,
    unregister,
    fetchingSymbol,
  }), [get, mapState, register, unregister, fetchingSymbol]);

  return (
    <PriceCenterContext.Provider value={value}>
      {children}
    </PriceCenterContext.Provider>
  );
};

/**
 * 统一的状态推导 deriveStatus（状态机核心）：
 * - open（盘中）：只要价格过期才标记为 stale（待更新），否则为 live（实时）；
 * - pre（盘前）：有价且新鲜 → pending（就绪中），过期 → stale（待更新）；
 * - post / closed（盘后 / 休市）：有价一律视为 closed（已收盘），不再使用 stale；
 * - 无价：open/pre → pending（等待首次拉价），post/closed → closed（休市无价）。
 */
function deriveStatus(price: number | null, ts: number): RtStatus {
  const now = Date.now();
  const sess = getMarketSession(new Date());

  // （1）没有价格的场景：盘中/盘前视为等待返回，盘后/休市视为正常休市
  if (price == null) {
    if (sess === 'open' || sess === 'pre') {
      // 交易尚在进行（或即将进行），但当前没有任何价格 → pending（等待首次拉价）
      return 'pending';
    }
    // 盘后 / 休市 且无价：视为 closed（已收盘/休市），不是异常
    return 'closed';
  }

  // （2）盘中：严格按新鲜度判断 live / stale
  if (sess === 'open') {
    return now - ts > FRESHNESS_MS ? 'stale' : 'live';
  }

  // （3）盘前：有价但未开盘，新鲜 → pending（就绪），过旧 → stale（有问题）
  if (sess === 'pre') {
    return now - ts > FRESHNESS_MS ? 'stale' : 'pending';
  }

  // （4）盘后 / 休市：有价 = 正常日终/停牌场景 → 一律 closed（已收盘），不再用 stale
  return 'closed';
}

/**
 * usePriceCenterContext（价格中心上下文 hook 钩子）：
 * 让页面上的组件去读价格中心的 get/map/register/unregister
 */
export function usePriceCenterContext(): PriceCenterCtx {
  const ctx = useContext(PriceCenterContext);
  if (!ctx) throw new Error('RealTimePricesProvider is missing');
  return ctx;
}