'use client';

import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@/firebase';
import { useUserTransactions, type Tx } from './use-user-transactions';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import {
  nowNyCalendarDayString,
  toNyCalendarDayString,
  nyWeekdayIndex,
  toNyHmsString,
} from '@/lib/ny-time';
import {
  getMany as getOfficialCloses,
  type OfficialCloseResult,
} from '@/lib/data/official-close-repo';
import { useRealTimePrices } from '@/price/useRealTimePrices';

// —— 日内盈亏状态枚举（Day PnL Status，日盈亏状态标记）
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

// 实时报价状态（RtStatus，Real-time Status，实时价格状态）
type RtStatus = 'live' | 'stale' | 'closed' | 'pending' | 'error';

const US_MARKET_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
]);

// 盘中实时价“新鲜度”阈值（Freshness 毫秒）
const FRESHNESS_MS = 15_000;

// —— 客户端股票代码归一化（Symbol Normalize，股票代码标准化）
const normalizeSymbolForClient = (s: string): string =>
  (s ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();

// 兼容别名
const normalizeSymbolClient = normalizeSymbolForClient;

// 用数值化方式判断常规时段是否开盘（NY 纽交所时区）
function isNyRegularSessionOpen(now: Date): boolean {
  const wd = nyWeekdayIndex(now);
  if (wd === 0 || wd === 6) return false;

  const nyD = toNyCalendarDayString(now) ?? nowNyCalendarDayString();
  if (US_MARKET_HOLIDAYS.has(nyD)) return false;

  const hms = toNyHmsString(now);
  const [hh, mm, ss] = hms.split(':').map((n) => parseInt(n, 10));
  const t = hh * 3600 + mm * 60 + ss;

  const OPEN = 9 * 3600 + 30 * 60;
  const CLOSE = 16 * 3600;

  return t >= OPEN && t < CLOSE;
}

function getNyMarketSessionLocal(
  now: Date,
): 'pre-market' | 'open' | 'post-market' | 'closed' {
  const wd = nyWeekdayIndex(now);
  const nyD = toNyCalendarDayString(now);

  if (wd === 0 || wd === 6 || US_MARKET_HOLIDAYS.has(nyD)) return 'closed';

  const [hh, mm, ss] = toNyHmsString(now).split(':').map((n) => parseInt(n, 10));
  const t = hh * 3600 + mm * 60 + ss;

  const PRE_OPEN = 4 * 3600;
  const OPEN = 9 * 3600 + 30 * 60;
  const CLOSE = 16 * 3600;
  const POST_END = 20 * 3600;

  if (t >= OPEN && t < CLOSE) return 'open';
  if (t >= PRE_OPEN && t < OPEN) return 'pre-market';
  if (t >= CLOSE && t < POST_END) return 'post-market';
  return 'closed';
}

function prevNyTradingDayString(base: string): string {
  // base 是 NY 交易日 'YYYY-MM-DD'
  let [year, month, day] = base.split('-').map(Number);
  let ts = Date.UTC(year, month - 1, day, 12, 0, 0);
  ts -= 24 * 60 * 60 * 1000;

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

// —— 单标的“当日盈亏”计算（Day PnL，单标的日内盈亏）
function computeDayPnLSymbol(
  holding: { netQty: number; multiplier: number },
  marketSession: 'pre-market' | 'open' | 'post-market' | 'closed',
  isTradingDay: boolean,
  lastPriceData: { price: number | null; ts: number } | undefined,
  refEod: OfficialCloseResult | undefined,
  todayEod: OfficialCloseResult | undefined,
  todaysTrades: Tx[],
): { todayPl: number | null; todayPlStatus: DayPlStatus } {
  if (marketSession === 'pre-market')
    return { todayPl: null, todayPlStatus: 'session-pre' };
  if (marketSession === 'post-market')
    return { todayPl: null, todayPlStatus: 'session-post' };

  const prevClose =
    refEod?.status === 'ok' && refEod?.close != null ? refEod.close : undefined;

  if (prevClose === undefined) {
    if (refEod?.status === 'pending') {
      return { todayPl: null, todayPlStatus: 'pending-eod-fetch' };
    }
    return { todayPl: null, todayPlStatus: 'missing-ref-eod' };
  }

  let refPrice: number | undefined;
  let status: DayPlStatus = 'live';

  if (marketSession === 'open') {
    if (lastPriceData?.price != null) {
      if (Date.now() - lastPriceData.ts > FRESHNESS_MS) {
        return { todayPl: null, todayPlStatus: 'stale-last' };
      }
      refPrice = lastPriceData.price;
      status = 'live';
    } else {
      return { todayPl: null, todayPlStatus: 'degraded' };
    }
  } else {
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

  const { netQty, multiplier } = holding;
  const sumTradesEffect = todaysTrades.reduce((sum, tx) => {
    return sum + (tx.price - prevClose) * tx.qty;
  }, 0);

  const rawPnl = netQty * (refPrice - prevClose) - sumTradesEffect;
  const todayPl = Math.round(rawPnl * multiplier * 100) / 100;

  return { todayPl, todayPlStatus: status };
}

export interface HoldingRow {
  symbol: string;
  assetType: 'stock' | 'option';
  netQty: number;
  avgCost: number | null;
  multiplier: number;
  last: number | null;
  mv: number | null;
  pnl: number | null;
  pnlPct: number | null;
  todayPl: number | null;
  todayPlPct: number | null;
  todayPlStatus: DayPlStatus;
  dayChange: number | null;
  dayChangePct: number | null;
  dayChangeStatus?: 'under-construction';
  dayQtyDelta?: number;
  dayNotional?: number;
  // 实时报价状态：直接来自价格中心的 RtStatus（实时价格状态）
  priceStatus?: RtStatus;
}

export interface HoldingsSummary {
  totalMv: number | null;
  totalPnl: number | null;
  totalTodayPl: number | null;
  aggTodayPlStatus: AggTodayStatus;

  // 总持仓市值 GMV（Gross Market Value，总持仓市值，绝对值口径）
  totalGrossMv: number | null;

  // 净现金投入 NCI（Net Cash Invested，净现金投入，绝对值口径）
  totalNci: number | null;

  // 首页三个计算格子的专属状态
  gmvStatus: AggTodayStatus;
  nciStatus: AggTodayStatus;
  pnlStatus: AggTodayStatus;
}

export function useHoldings() {
  const { user } = useUser();
  const { data: transactions, loading: txLoading } = useUserTransactions(user?.uid);

  // 1) 基础持仓层（Base Holdings，基础持仓快照）
  const baseHoldings = useMemo(() => {
    const list = Array.isArray(transactions) ? (transactions as Tx[]) : [];
    if (list.length === 0) return [];
    const snap = buildHoldingsSnapshot(list);
    return snap.holdings ?? [];
  }, [transactions]);

  // 2) 当日成交聚合（用于 Day PnL，按 NY 交易日聚合）
  const dailyTxAggregates = useMemo(() => {
    const aggregates = new Map<
      string,
      { dayQtyDelta: number; dayNotional: number; trades: Tx[] }
    >();

    const todayNy = nowNyCalendarDayString();
    const now = new Date();
    const wd = nyWeekdayIndex(now);
    const isTradingDay = wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(todayNy);
    const baseDay = isTradingDay ? todayNy : prevNyTradingDayString(todayNy);

    if (Array.isArray(transactions)) {
      for (const tx of transactions) {
        const ts = tx.transactionTimestamp;
        if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
          continue;
        }
        const txDay = toNyCalendarDayString(ts);
        if (txDay !== baseDay) continue;

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

  // 3) 统一需要实时价的 symbol 列表 + 接入价格中心
  const uniqueSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          baseHoldings
            .map((h: any) => normalizeSymbolClient(h.symbol))
            .filter(Boolean),
        ),
      ),
    [baseHoldings],
  );

  const { get: getPriceRecord } = useRealTimePrices(uniqueSymbols);

  // 4) 获取 EOD（日终收盘价，End of Day）作为 Day PnL 基线
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

  // 5) 组装最终行 + 汇总（含 GMV / NCI / Day PnL）
  const { rows, summary } = useMemo(
    (): { rows: HoldingRow[]; summary: HoldingsSummary } => {
      let totalMv = 0;
      let totalPnl = 0;
      let totalTodayPl = 0;

      let totalGrossMv = 0;
      let hasGrossMv = false;

      let totalNci = 0;
      let hasNci = false;

      const allStatuses: DayPlStatus[] = [];

      // 覆盖率标记：只要有持仓但缺必要参数，就标记为缺失
      let gmvMissing = false;
      let nciMissing = false;
      let pnlMissing = false;

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

        const priceRecord = getPriceRecord(normalizedSymbol);

        const last =
          priceRecord &&
          typeof priceRecord.price === 'number' &&
          Number.isFinite(priceRecord.price)
            ? priceRecord.price
            : null;

        const lastPriceData =
          priceRecord != null
            ? { price: priceRecord.price, ts: priceRecord.ts }
            : undefined;

        // 透传价格状态给 HoldingRow，用于前台“实时价格”徽章
        const priceStatus: RtStatus | undefined =
          priceRecord && typeof priceRecord.status === 'string'
            ? (priceRecord.status as RtStatus)
            : undefined;

        const mv = last !== null ? netQty * multiplier * last : null;
        const costBasis =
          avgCost !== null ? netQty * multiplier * avgCost : null;
        const pnl = mv !== null && costBasis !== null ? mv - costBasis : null;
        const pnlPct =
          pnl !== null && costBasis !== null && costBasis !== 0
            ? pnl / Math.abs(costBasis)
            : null;

        // —— GMV：总持仓市值（绝对值口径）覆盖率 + 汇总
        if (netQty !== 0) {
          if (last === null) {
            gmvMissing = true;
          } else {
            const grossMv = Math.abs(netQty) * multiplier * last;
            totalGrossMv += grossMv;
            hasGrossMv = true;
          }
        }

        // —— NCI：净现金投入（绝对值口径）覆盖率 + 汇总
        if (netQty !== 0) {
          if (avgCost === null) {
            nciMissing = true;
          } else {
            const absQty = Math.abs(netQty);
            const nciSingle = absQty * multiplier * avgCost;
            totalNci += nciSingle;
            hasNci = true;
          }
        }

        // —— 持仓浮盈：只要有持仓但 mv 或 costBasis 缺，就视为覆盖不完整
        if (netQty !== 0 && (mv === null || costBasis === null)) {
          pnlMissing = true;
        }

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
          priceStatus,
        };
      });

      // —— Day PnL 汇总状态（沿用原逻辑）
      const statusSet = new Set(allStatuses);
      let aggTodayPlStatus: AggTodayStatus;

      if ([...statusSet].every((s) => s === 'live' || s === 'closed')) {
        aggTodayPlStatus = marketSession === 'open' ? 'live' : 'closed';
      } else if (
        statusSet.size === 1 &&
        (statusSet.has('session-pre') ||
          statusSet.has('session-post') ||
          statusSet.has('stale-last'))
      ) {
        aggTodayPlStatus = [...statusSet][0] as AggTodayStatus;
      } else if ([...statusSet].some((s) => (s as string).startsWith('missing-'))) {
        aggTodayPlStatus = 'degraded';
      } else if (statusSet.has('pending-eod-fetch')) {
        aggTodayPlStatus = 'pending-eod-fetch';
      } else {
        aggTodayPlStatus = 'degraded';
      }

      const finalTotalMv = rows.every((r) => r.mv === null) ? null : totalMv;
      const finalTotalPnl = rows.every((r) => r.pnl === null) ? null : totalPnl;
      const finalTotalTodayPl =
        rows.every((r) => r.todayPl === null) ? null : totalTodayPl;
      const finalTotalGrossMv = hasGrossMv ? totalGrossMv : null;
      const finalTotalNci = hasNci ? totalNci : null;

      // —— 会话基线状态（Session Status，只负责“盘中 / 待开盘 / 已收盘”）
      let baseSessionStatus: AggTodayStatus;
      if (marketSession === 'open') {
        baseSessionStatus = 'live';
      } else if (marketSession === 'pre-market') {
        baseSessionStatus = 'session-pre';
      } else if (marketSession === 'post-market') {
        baseSessionStatus = 'session-post';
      } else {
        baseSessionStatus = 'closed';
      }

      // —— GMV 状态：参数驱动（修正后版本，收盘后不再强制 stale-last）
      let gmvStatus: AggTodayStatus;
      if (!hasGrossMv) {
        // 没有任何可计算 GMV 的持仓（例如全空仓）
        gmvStatus = 'degraded';
      } else if (gmvMissing) {
        // 有持仓但缺实时价 → “待更新”
        gmvStatus = 'stale-last';
      } else {
        // 数据完整 → 严格跟随会话状态
        // open         → live（盘中）
        // pre-market   → session-pre（待开盘）
        // post-market  → session-post（已收盘口径）
        // closed       → closed（休市/周末）
        gmvStatus = baseSessionStatus;
      }

      // —— NCI 状态：只看成本完整 + 时间窗口（不依赖实时价/EOD）
      let nciStatus: AggTodayStatus;
      if (!hasNci || nciMissing) {
        // 成本不完整 → 直接降级为 degraded（降级/待补充）
        nciStatus = 'degraded';
      } else {
        // 成本完整 → 跟随会话状态
        nciStatus = baseSessionStatus;
      }

      // —— 持仓浮盈状态：同时依赖 GMV + NCI 的完整度
      let pnlStatus: AggTodayStatus;
      if (!hasGrossMv || !hasNci || pnlMissing) {
        pnlStatus = 'degraded';
      } else {
        pnlStatus = baseSessionStatus;
      }

      return {
        rows,
        summary: {
          totalMv: finalTotalMv,
          totalPnl: finalTotalPnl,
          totalTodayPl: finalTotalTodayPl,
          aggTodayPlStatus,
          totalGrossMv: finalTotalGrossMv,
          totalNci: finalTotalNci,
          gmvStatus,
          nciStatus,
          pnlStatus,
        },
      };
    },
    [baseHoldings, dailyTxAggregates, refEodMap, todayEodMap, getPriceRecord],
  );

  const loading = txLoading || eodLoading;
  return { rows, summary, loading };
}