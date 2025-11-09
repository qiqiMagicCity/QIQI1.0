'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useFirestore, useUser } from '@/firebase';
import { useUserTransactions, type Tx } from './use-user-transactions';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';

import {
  nowNyCalendarDayString,
  toNyCalendarDayString,
  nyWeekdayIndex,
  toNyHmsString,
} from '@/lib/ny-time';
import { getMany as getOfficialCloses, type OfficialCloseResult } from '@/lib/data/official-close-repo';

// —— 统一状态枚举（避免交叉引用接口导致的类型顺序问题）
type DayPlStatus =
  | 'live'
  | 'closed'
  | 'session-pre'
  | 'session-post'
  | 'missing-ref-eod'
  | 'missing-today-eod'
  | 'pending-eod-fetch'
  | 'stale-last'
  | 'degraded';

type AggTodayStatus =
  | 'live'
  | 'closed'
  | 'session-pre'
  | 'session-post'
  | 'stale-last'
  | 'pending-eod-fetch'
  | 'degraded';

const US_MARKET_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  // 2026
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
]);
// 仅用于“是否开盘”判断；半日市先不处理（对盘中无影响）。

const FRESHNESS_MS = 15000; // 15s 新鲜度阈值（盘中实时价）

// —— 客户端股票代码归一化（本地实现，统一入口）
const normalizeSymbolForClient = (s: string): string =>
  (s ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();

// 兼容别名：老代码若调用 normalizeSymbolClient，不再报错
const normalizeSymbolClient = normalizeSymbolForClient;

// 用数值化方式判断常规时段是否开盘（NY 时区）
function isNyRegularSessionOpen(now: Date): boolean {
  // 0=Sun..6=Sat
  const wd = nyWeekdayIndex(now);
  if (wd === 0 || wd === 6) return false;

  // 交易日屏蔽：全天休市表
  const nyD = toNyCalendarDayString(now) ?? nowNyCalendarDayString();
  if (US_MARKET_HOLIDAYS.has(nyD)) return false;

  // HH:mm:ss → 数字秒
  const hms = toNyHmsString(now);
  const [hh, mm, ss] = hms.split(':').map(n => parseInt(n, 10));
  const t = hh * 3600 + mm * 60 + ss;

  const OPEN = 9 * 3600 + 30 * 60;   // 09:30:00
  const CLOSE = 16 * 3600;           // 16:00:00

  return t >= OPEN && t < CLOSE;
}

function getNyMarketSessionLocal(now: Date): 'pre-market' | 'open' | 'post-market' | 'closed' {
  // 周末或节假日：直接 closed
  const wd = nyWeekdayIndex(now);
  const nyD = toNyCalendarDayString(now);
  if (wd === 0 || wd === 6 || US_MARKET_HOLIDAYS.has(nyD)) return 'closed';

  const [hh, mm, ss] = toNyHmsString(now).split(':').map(n => parseInt(n, 10));
  const t = hh * 3600 + mm * 60 + ss;

  const PRE_OPEN = 4 * 3600;          // 04:00:00
  const OPEN = 9 * 3600 + 30 * 60;    // 09:30:00
  const CLOSE = 16 * 3600;            // 16:00:00
  const POST_END = 20 * 3600;         // 20:00:00

  if (t >= OPEN && t < CLOSE) return 'open';
  if (t >= PRE_OPEN && t < OPEN) return 'pre-market';
  if (t >= CLOSE && t < POST_END) return 'post-market';
  return 'closed';
}

function prevNyTradingDayString(base: string): string {
  // Assumes base is 'YYYY-MM-DD' in NY timezone
  // Use UTC to avoid local timezone issues when manipulating dates
  let [year, month, day] = base.split('-').map(Number);
  let ts = Date.UTC(year, month - 1, day, 12, 0, 0); // Noon UTC to be safe

  ts -= 24 * 60 * 60 * 1000; // Subtract one day

  // 回退直到遇到工作日且不在假日表
  for (;;) {
    const candidateDate = new Date(ts);
    const candidateStr = toNyCalendarDayString(candidateDate);
    const wd = nyWeekdayIndex(candidateDate);

    if (wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(candidateStr)) {
      return candidateStr;
    }
    ts -= 24 * 60 * 60 * 1000;
  }
}

function computeDayPnLSymbol(
  holding: { netQty: number; multiplier: number },
  marketSession: 'pre-market' | 'open' | 'post-market' | 'closed',
  isTradingDay: boolean, // 目前未用，保留占位
  lastPriceData: { price: number | null; ts: number } | undefined,
  refEod: OfficialCloseResult | undefined,
  todayEod: OfficialCloseResult | undefined,
  todaysTrades: Tx[],
): { todayPl: number | null; todayPlStatus: DayPlStatus } {
  // 1) 不可计算的会话
  if (marketSession === 'pre-market') return { todayPl: null, todayPlStatus: 'session-pre' };
  if (marketSession === 'post-market') return { todayPl: null, todayPlStatus: 'session-post' };

  // 2) 昨收价（refDay 收盘）
  const prevClose =
    refEod?.status === 'ok' && refEod?.close != null ? refEod.close : undefined;
  if (prevClose === undefined) {
    if (refEod?.status === 'pending') {
      return { todayPl: null, todayPlStatus: 'pending-eod-fetch' };
    }
    return { todayPl: null, todayPlStatus: 'missing-ref-eod' };
  }

  // 3) 参考价 refPrice
  let refPrice: number | undefined;
  let status: DayPlStatus = 'live'; // open 的默认状态

  if (marketSession === 'open') {
    if (lastPriceData?.price != null) {
      if (Date.now() - lastPriceData.ts > FRESHNESS_MS) {
        return { todayPl: null, todayPlStatus: 'stale-last' };
      }
      refPrice = lastPriceData.price;
      status = 'live';
    } else {
      // 严禁托底：盘中没有实时价，直接降级，不产出伪数值
      return { todayPl: null, todayPlStatus: 'degraded' };
    }
  } else {
    // closed：一律用 todayEod（其中周末/节假日的 todayEod 已承载 baseDay 的收盘价）
    status = 'closed';

    if (todayEod?.status === 'ok' && todayEod?.close != null) {
      refPrice = todayEod.close;
    } else {
      if (todayEod?.status === 'pending') {
        return { todayPl: null, todayPlStatus: 'pending-eod-fetch' };
      }
      return { todayPl: null, todayPlStatus: 'missing-today-eod' };
    }
  }

  // 4) 计算日内 PnL
  // raw = 净持仓 * (参考价 - 昨收) - Σ (成交价 - 昨收) * 成交数量
  const { netQty, multiplier } = holding;

  const sumTradesEffect = todaysTrades.reduce((sum, tx) => {
    return sum + (tx.price - prevClose) * tx.qty;
  }, 0);

  const rawPnl = netQty * (refPrice - prevClose) - sumTradesEffect;

  // 5) 乘合约倍数，保留两位
  const todayPl = Math.round(rawPnl * multiplier * 100) / 100;

  return { todayPl, todayPlStatus: status };
}

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
  todayPl: number | null;       // 当日盈亏
  todayPlPct: number | null;    // 当日盈亏率（占位，后续版本实现）
  todayPlStatus: DayPlStatus;
  dayChange: number | null;     // 当日变动（v1 暂停计算）
  dayChangePct: number | null;  // 当日变动率（v1 暂停计算）
  dayChangeStatus?: 'under-construction'; // v1：建设中标记
  dayQtyDelta?: number;
  dayNotional?: number;
}

export interface HoldingsSummary {
  totalMv: number | null;
  totalPnl: number | null;
  totalTodayPl: number | null;
  aggTodayPlStatus: AggTodayStatus;
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

  // 2) 聚合当日交易量和交易额（以 baseDay 为“今天”）
  const dailyTxAggregates = useMemo(() => {
    const aggregates = new Map<
      string,
      { dayQtyDelta: number; dayNotional: number; trades: Tx[] }
    >();

    // 与 EOD 同口径：基准交易日 = 交易日为今天；周末/假日回退到上一个交易日
    const todayNy = nowNyCalendarDayString();
    const now = new Date();
    const wd = nyWeekdayIndex(now);
    const isTradingDay = wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(todayNy);
    const baseDay = isTradingDay ? todayNy : prevNyTradingDayString(todayNy);

    if (Array.isArray(transactions)) {
      for (const tx of transactions) {
        const ts = tx.transactionTimestamp; // 用标准化过的时间戳

        if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
          continue;
        }

        const txDay = toNyCalendarDayString(ts);
        if (txDay !== baseDay) {
          continue;
        }

        const symbol = normalizeSymbolClient(tx.symbol);
        const qty = tx.qty;
        const price = tx.price;

        let entry = aggregates.get(symbol);
        if (!entry) {
          entry = { dayQtyDelta: 0, dayNotional: 0, trades: [] };
          aggregates.set(symbol, entry);
        }
        entry.dayQtyDelta += qty;
        entry.dayNotional += price * qty;
        entry.trades.push(tx);
      }
    }
    return aggregates;
  }, [transactions]);

  // 3) 为持仓中的 symbols 订阅/拉取价格
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const priceCache =
    useRef<Map<string, { price: number | null; ts: number }>>(new Map()).current;
  const CONCURRENT_LIMIT = 3;
  const CACHE_TTL_MS = 60 * 1000;

  const uniqueSymbols = useMemo(
    () => Array.from(new Set(baseHoldings.map(h => h.symbol))).filter(Boolean),
    [baseHoldings],
  );

  useEffect(() => {
    if (!firestore || uniqueSymbols.length === 0) {
      setPrices({});
      setPriceLoading(false);
      return;
    }

    setPriceLoading(true);

    const unsubs: Unsubscribe[] = uniqueSymbols.map(symbol => {
      const ref = doc(firestore, 'stockDetails', symbol);
      return onSnapshot(ref, snap => {
        if (snap.exists()) {
          const data: any = snap.data();
          const price = (data?.last ?? data?.close ?? null) as number | null;
          setPrices(prev => ({ ...prev, [symbol]: price }));
          if (price !== null) {
            priceCache.set(symbol, { price, ts: Date.now() });
          }
        }
      });
    });

    const fetchMissingPrices = async () => {
      const functions = getFunctions(undefined, 'us-central1');
      const priceQuote = httpsCallable(functions, 'priceQuote');
      const symbolsToFetch: string[] = [];

      for (const symbol of uniqueSymbols) {
        const cached = priceCache.get(symbol);
        if (!cached || Date.now() - cached.ts > CACHE_TTL_MS) {
          symbolsToFetch.push(symbol);
        }
      }

      if (symbolsToFetch.length === 0) {
        setPriceLoading(false);
        return;
      }

      let activeRequests = 0;
      const executing = new Set<string>();

      const processQueue = async () => {
        while (activeRequests < CONCURRENT_LIMIT && symbolsToFetch.length > 0) {
          const symbol = symbolsToFetch.shift();
          if (symbol && !executing.has(symbol)) {
            activeRequests++;
            executing.add(symbol);

            priceQuote({ symbol })
              .then(result => {
                const price = (result?.data as any)?.price as number | null;
                if (price !== null && typeof price === 'number') {
                  setPrices(prev => ({ ...prev, [symbol]: price }));
                  priceCache.set(symbol, { price, ts: Date.now() });
                }
              })
              .catch(err => {
                console.error(`Failed to fetch price for ${symbol}`, err);
                priceCache.set(symbol, { price: null, ts: Date.now() });
              })
              .finally(() => {
                activeRequests--;
                executing.delete(symbol);
                processQueue();
              });
          }
        }

        if (executing.size === 0 && symbolsToFetch.length === 0) {
          setPriceLoading(false);
        }
      };

      processQueue();
    };

    fetchMissingPrices();

    return () => {
      unsubs.forEach(u => u());
    };
  }, [firestore, uniqueSymbols, priceCache]);

  // 4) 获取 EOD 价格作为日盈亏基线
  const [refEodMap, setRefEodMap] = useState<Record<string, OfficialCloseResult>>({});
  const [todayEodMap, setTodayEodMap] = useState<Record<string, OfficialCloseResult>>({});
  const [eodLoading, setEodLoading] = useState(false);

  useEffect(() => {
    if (uniqueSymbols.length === 0) {
      setRefEodMap({});
      setTodayEodMap({});
      setEodLoading(false);
      return;
    }

    const fetchEod = async () => {
      setEodLoading(true);
      const todayNy = nowNyCalendarDayString();

      // 基准交易日：交易日=今天；周末/节假日=回退到上一个交易日
      const now = new Date();
      const wd = nyWeekdayIndex(now);
      const isTradingDay = wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(todayNy);
      const baseDay = isTradingDay ? todayNy : prevNyTradingDayString(todayNy);
      const refDay = prevNyTradingDayString(baseDay);

      try {
        const symbolsNorm = uniqueSymbols.map(normalizeSymbolForClient);
        const [refCloses, todayCloses] = await Promise.all([
          getOfficialCloses(refDay, symbolsNorm, { shouldAutoRequestBackfill: true }),
          getOfficialCloses(baseDay, symbolsNorm, { shouldAutoRequestBackfill: true }),
        ]);

        setRefEodMap(refCloses);
        setTodayEodMap(todayCloses);
      } catch (error) {
        console.error('Failed to fetch official closes:', error);
        setRefEodMap({});
        setTodayEodMap({});
      } finally {
        setEodLoading(false);
      }
    };

    fetchEod();
  }, [uniqueSymbols]);

  // 5) 组装最终行（含 MV / PnL / Day PnL）
  const { rows, summary } = useMemo((): { rows: HoldingRow[]; summary: HoldingsSummary } => {
    let totalMv = 0;
    let totalPnl = 0;
    let totalTodayPl = 0;
    const allStatuses: DayPlStatus[] = [];

    const now = new Date();
    const marketSession = getNyMarketSessionLocal(now);
    const currentNyDay = toNyCalendarDayString(now);
    const isTradingDay =
      !US_MARKET_HOLIDAYS.has(currentNyDay) &&
      nyWeekdayIndex(now) > 0 &&
      nyWeekdayIndex(now) < 6;

    const rows = baseHoldings.map((h: any): HoldingRow => {
      const symbol: string = h.symbol;
      const normalizedSymbol = normalizeSymbolForClient(symbol);
      const netQty: number = h.netQty ?? 0;
      const avgCost: number | null = h.costPerUnit ?? null;
      const multiplier: number = h.multiplier ?? 1;
      const assetType: 'stock' | 'option' =
        h.assetType ?? (multiplier !== 1 ? 'option' : 'stock');

      const last = prices[symbol] ?? null;
      const lastPriceData = priceCache.get(symbol);

      const mv = last !== null ? netQty * multiplier * last : null;
      const costBasis = avgCost !== null ? netQty * multiplier * avgCost : null;
      const pnl = mv !== null && costBasis !== null ? mv - costBasis : null;
      const pnlPct =
        pnl !== null && costBasis !== null && costBasis !== 0
          ? pnl / Math.abs(costBasis)
          : null;

      const dailyAgg = dailyTxAggregates.get(normalizedSymbol);
      const todaysTrades = dailyAgg?.trades ?? [];

      const { todayPl, todayPlStatus } = computeDayPnLSymbol(
        { netQty, multiplier },
        marketSession,
        isTradingDay,
        lastPriceData,
        refEodMap[normalizedSymbol],
        todayEodMap[normalizedSymbol],
        todaysTrades,
      );
      allStatuses.push(todayPlStatus);

      // v1：当日变动 / 当日变动% 暂停，标记建设中
      const todayPlPct: number | null = null;
      const dayChange: number | null = null;
      const dayChangePct: number | null = null;
      const dayChangeStatus: 'under-construction' = 'under-construction';

      if (mv !== null) totalMv += mv;
      if (pnl !== null) totalPnl += pnl;
      if (todayPl !== null) totalTodayPl += todayPl;

      return {
        symbol,
        assetType,
        netQty,
        avgCost,
        multiplier,
        last,
        mv,
        pnl,
        pnlPct,
        todayPl,
        todayPlPct,
        todayPlStatus,
        dayChange,
        dayChangePct,
        dayChangeStatus,
        dayQtyDelta: dailyAgg?.dayQtyDelta ?? 0,
        dayNotional: dailyAgg?.dayNotional ?? 0,
      };
    });

    // —— 汇总状态：与行级保持一致的白名单与降级策略
    const statusSet = new Set(allStatuses);

    let aggTodayPlStatus: AggTodayStatus;

    if ([...statusSet].every(s => s === 'live' || s === 'closed')) {
      aggTodayPlStatus = marketSession === 'open' ? 'live' : 'closed';
    } else if (
      statusSet.size === 1 &&
      (statusSet.has('session-pre') ||
        statusSet.has('session-post') ||
        statusSet.has('stale-last'))
    ) {
      // 单一会话型状态 → 原样抬到汇总
      aggTodayPlStatus = [...statusSet][0] as AggTodayStatus;
    } else if ([...statusSet].some(s => (s as string).startsWith('missing-'))) {
      aggTodayPlStatus = 'degraded';
    } else if (statusSet.has('pending-eod-fetch')) {
      aggTodayPlStatus = 'pending-eod-fetch';
    } else {
      aggTodayPlStatus = 'degraded';
    }

    const finalTotalMv = rows.every(r => r.mv === null) ? null : totalMv;
    const finalTotalPnl = rows.every(r => r.pnl === null) ? null : totalPnl;
    const finalTotalTodayPl = rows.every(r => r.todayPl === null) ? null : totalTodayPl;

    return {
      rows,
      summary: {
        totalMv: finalTotalMv,
        totalPnl: finalTotalPnl,
        totalTodayPl: finalTotalTodayPl,
        aggTodayPlStatus,
      },
    };
  }, [baseHoldings, prices, refEodMap, todayEodMap, dailyTxAggregates, priceCache]);

  const loading = txLoading || priceLoading || eodLoading;

  return { rows, summary, loading };
}
