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
  US_MARKET_HOLIDAYS,
  prevNyTradingDayString,
  getEffectiveTradingDay,
  isNyTradingDay,
  getPeriodStartDates,
  getPeriodBaseDates,
} from '@/lib/ny-time';
// ★ [FIX] 修正导入：直接导入 getOfficialCloses
import {
  getOfficialCloses,
  type OfficialCloseResult,
} from '@/lib/data/official-close-repo';
import { useRealTimePrices } from '@/price/useRealTimePrices';

// —— 日内盈亏状态枚举
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

// 实时报价状态
type RtStatus = 'live' | 'stale' | 'closed' | 'pending' | 'error';

const FRESHNESS_MS = 60_000; // 1分钟

// —— 客户端股票代码归一化
const normalizeSymbolForClient = (s: string): string =>
  (s ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();

const normalizeSymbolClient = normalizeSymbolForClient;

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

// —— 单标的“当日盈亏”计算
function computeDayPnLSymbol(
  holding: { netQty: number; multiplier: number },
  marketSession: 'pre-market' | 'open' | 'post-market' | 'closed',
  isTradingDay: boolean,
  lastPriceData: { price: number | null; ts: number } | undefined,
  refEod: OfficialCloseResult | undefined,
  todayEod: OfficialCloseResult | undefined,
  todaysTrades: Tx[],
  refEodDate?: string,
): {
  todayPl: number | null;
  todayPlStatus: DayPlStatus;
  refPrice: number | null;
  prevClose: number | null;
  refDateUsed?: string;
} {
  const prevClose =
    refEod?.status === 'ok' && refEod?.close != null ? refEod.close : undefined;

  if (prevClose === undefined) {
    if (refEod?.status === 'pending') {
      return {
        todayPl: null,
        todayPlStatus: 'pending-eod-fetch',
        refPrice: null,
        prevClose: null,
      };
    }
    return {
      todayPl: null,
      todayPlStatus: 'missing-ref-eod',
      refPrice: null,
      prevClose: null,
    };
  }

  let refPrice: number | undefined;
  let status: DayPlStatus = 'live';

  if (todayEod?.status === 'ok' && todayEod?.close != null) {
    refPrice = todayEod.close;
    status = 'closed';
  } else if (lastPriceData?.price != null) {
    const isStale = Date.now() - lastPriceData.ts > FRESHNESS_MS;
    refPrice = lastPriceData.price;
    status = isStale ? 'stale-last' : 'live';
  } else {
    if (todayEod?.status === 'pending') {
      return {
        todayPl: null,
        todayPlStatus: 'pending-eod-fetch',
        refPrice: null,
        prevClose,
      };
    }
    return {
      todayPl: null,
      todayPlStatus: 'degraded',
      refPrice: null,
      prevClose,
    };
  }

  if (refPrice == null || !Number.isFinite(refPrice)) {
    return {
      todayPl: null,
      todayPlStatus: status,
      refPrice: null,
      prevClose,
    };
  }

  const { netQty, multiplier } = holding;
  // M6 Algorithm Implementation (Daily PnL Change)
  // Based on GLOBAL_RULES.md Section 6.6
  //
  // The goal is to calculate the sum of:
  // A. Overnight Positions PnL: (CurrentPrice - PrevClose) * OvernightQty
  // B. New Positions Held PnL: (CurrentPrice - AvgBuyPrice) * NewHeldQty
  // C. Intraday Realized PnL: (SellPrice - BuyPrice) * RealizedQty
  //
  // Mathematical Equivalence:
  // The formula used below:
  //   RawPnL = NetQty * (RefPrice - PrevClose) - Sum((TradePrice - PrevClose) * TradeQty)
  //
  // Is mathematically proven to be equivalent to A + B + C.
  // - NetQty * (RefPrice - PrevClose) captures the total price movement relative to PrevClose.
  // - The adjustment term "- Sum((TradePrice - PrevClose) * TradeQty)" corrects for:
  //   1. Realized gains/losses (converting PrevClose baseline to TradePrice baseline for C).
  //   2. New positions cost basis (converting PrevClose baseline to TradePrice baseline for B).
  //
  const sumTradesEffect = todaysTrades.reduce((sum, tx) => {
    return sum + (tx.price - prevClose) * tx.qty;
  }, 0);

  const rawPnl = netQty * (refPrice - prevClose) - sumTradesEffect;
  const todayPl = Math.round(rawPnl * multiplier * 100) / 100;
  return {
    todayPl,
    todayPlStatus: status,
    refPrice,
    prevClose,
    refDateUsed: refEodDate,
  };
}

export interface HoldingRow {
  symbol: string;
  assetType: 'stock' | 'option';
  netQty: number;
  avgCost: number | null;
  breakEvenPrice: number | null;
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
  priceStatus?: RtStatus;
  anomalies?: string[];
  totalLifetimePnL?: number | null; // [NEW]
  refPrice?: number | null; // [DEBUG]
  prevClose?: number | null; // [DEBUG]
  refDateUsed?: string; // [DEBUG]
}

export interface HoldingsSummary {
  totalMv: number | null;
  totalPnl: number | null;
  totalTodayPl: number | null;
  aggTodayPlStatus: AggTodayStatus;
  totalGrossMv: number | null;
  totalNci: number | null;
  gmvStatus: AggTodayStatus;
  nciStatus: AggTodayStatus;
  pnlStatus: AggTodayStatus;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number | null;
  totalLifetimePnl: number | null;
  positionsCount: number;
  avgPositionSize: number | null;
  // New metrics
  todayRealizedPnlHistorical: number | null;
  todayTradingPnlIntraday: number | null;
  todayTradingPnlIntradayM5_1: number | null; // Trading Perspective
  todayTradingPnlIntradayM5_2: number | null; // FIFO Ledger Perspective
  todayTradeCount: number;
  todayTradeCounts: {
    buy: number;
    sell: number;
    short: number;
    cover: number;
    total: number;
  };
  totalTradeCount: number;
  totalTradeCounts: {
    buy: number;
    sell: number;
    short: number;
    cover: number;
    total: number;
  };
  winRate: number | null;
  winRateStats: {
    winCount: number;
    lossCount: number;
    winRate: number;
  };
  wtdWinRateStats: {
    winCount: number;
    lossCount: number;
    winRate: number;
  };
  mtdWinRateStats: {
    winCount: number;
    lossCount: number;
    winRate: number;
  };
  wtdTradeCounts: {
    buy: number;
    sell: number;
    short: number;
    cover: number;
    total: number;
  };
  mtdTradeCounts: {
    buy: number;
    sell: number;
    short: number;
    cover: number;
    total: number;
  };
  wtdPnl: number | null;
  mtdPnl: number | null;
  ytdPnl: number | null;
  // User Defined Metrics
  m4_historicalRealized: number | null; // M4: Today's Realized PnL (Historical Positions)
  m5_1_trading: number | null;          // M5.1: Today's Trading PnL (Trading Perspective)
  m5_2_ledger: number | null;           // M5.2: Today's Trading PnL (Ledger Perspective)
  totalHistoricalRealizedPnl: number | null; // M9: Total Historical Realized PnL
}

import { calcM5_1_Trading } from '@/lib/pnl/calc-m5-1-trading';
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo';
import { calcM11_Wtd } from '@/lib/pnl/calc-m11-wtd';
import { calcM12_Mtd } from '@/lib/pnl/calc-m12-mtd';
import { calcM13_Ytd } from '@/lib/pnl/calc-m13-ytd';


export function useHoldings() {
  const { user } = useUser();
  const { data: transactions, loading: txLoading } = useUserTransactions(user?.uid);

  const baseHoldings = useMemo(() => {
    const list = Array.isArray(transactions) ? (transactions as Tx[]) : [];
    if (list.length === 0) return [];
    const snap = buildHoldingsSnapshot(list);
    return snap.holdings ?? [];
  }, [transactions]);

  const dailyTxAggregates = useMemo(() => {
    const aggregates = new Map<
      string,
      { dayQtyDelta: number; dayNotional: number; trades: Tx[] }
    >();

    const todayNy = nowNyCalendarDayString();
    const now = new Date();

    // [FIX] 使用全局统一的日切逻辑 (09:30)
    const baseDay = getEffectiveTradingDay(now);

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

  const [refEodMap, setRefEodMap] = useState<Record<string, OfficialCloseResult>>({});
  const [todayEodMap, setTodayEodMap] = useState<Record<string, OfficialCloseResult>>({});
  // [NEW] Historical EOD Maps for WTD/MTD/YTD Base Dates
  const [wtdBaseEodMap, setWtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
  const [mtdBaseEodMap, setMtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
  const [ytdBaseEodMap, setYtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
  const [eodLoading, setEodLoading] = useState(false);

  useEffect(() => {
    if (uniqueSymbols.length === 0) {
      setRefEodMap({});
      setTodayEodMap({});
      setEodLoading(false);
      return;
    }

    let cancelled = false;

    const fetchEod = async () => {
      setEodLoading(true);
      const now = new Date();

      // [FIX] 使用全局统一的日切逻辑 (09:30)
      const baseDay = getEffectiveTradingDay(now);
      const refDay = prevNyTradingDayString(baseDay);
      // [NEW] Calculate Base Dates
      const { wtd: wtdBase, mtd: mtdBase, ytd: ytdBase } = getPeriodBaseDates(baseDay);

      try {
        const symbolsNorm = uniqueSymbols.map(normalizeSymbolForClient);
        const [refCloses, todayCloses, wtdBaseCloses, mtdBaseCloses, ytdBaseCloses] = await Promise.all([
          getOfficialCloses(refDay, symbolsNorm, { shouldAutoRequestBackfill: true }),
          getOfficialCloses(baseDay, symbolsNorm, { shouldAutoRequestBackfill: true }),
          getOfficialCloses(wtdBase, symbolsNorm, { shouldAutoRequestBackfill: true }),
          getOfficialCloses(mtdBase, symbolsNorm, { shouldAutoRequestBackfill: true }),
          getOfficialCloses(ytdBase, symbolsNorm, { shouldAutoRequestBackfill: true }),
        ]);
        if (cancelled) return;

        setRefEodMap(refCloses);
        setTodayEodMap(todayCloses);
        setWtdBaseEodMap(wtdBaseCloses);
        setMtdBaseEodMap(mtdBaseCloses);
        setYtdBaseEodMap(ytdBaseCloses);
      } catch (error) {
        console.error('Failed to fetch official closes:', error);
        if (cancelled) return;
      } finally {
        if (!cancelled) {
          setEodLoading(false);
        }
      }
    };

    fetchEod();

    return () => {
      cancelled = true;
    };
  }, [uniqueSymbols]);

  const { rows, summary } = useMemo(
    (): { rows: HoldingRow[]; summary: HoldingsSummary } => {
      let totalMv = 0;
      let totalPnl = 0;
      let totalTodayPl = 0;
      let totalGrossMv = 0;
      let hasGrossMv = false;
      let totalNci = 0;
      let hasNci = false;
      let totalRealizedPnl = 0;
      let positionsCount = 0;

      const allStatuses: DayPlStatus[] = [];
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

      const allSymbols = new Set<string>();
      baseHoldings.forEach((h: any) => allSymbols.add(normalizeSymbolForClient(h.symbol)));
      dailyTxAggregates.forEach((_, key) => allSymbols.add(key));

      const rows: HoldingRow[] = Array.from(allSymbols).map((symbolKey): HoldingRow => {
        // Find holding in baseHoldings
        const h = baseHoldings.find((h: any) => normalizeSymbolForClient(h.symbol) === symbolKey);

        const symbol = h ? h.symbol : symbolKey; // Use holding symbol or key
        const normalizedSymbol = symbolKey;
        const netQty: number = h ? (h.netQty ?? 0) : 0;
        const avgCost: number | null = h ? (h.costPerUnit ?? null) : null;
        const multiplier: number = h ? (h.multiplier ?? 1) : 1; // Default to 1 if unknown, but maybe check trades?
        // If h is missing, try to infer multiplier from trades? 
        // For simplicity, if h is missing (closed), we might need to look at trades to get multiplier.
        // But computeDayPnLSymbol needs multiplier.
        // Let's try to get multiplier from dailyTxAggregates if h is missing.
        let effectiveMultiplier = multiplier;
        if (!h) {
          const agg = dailyTxAggregates.get(normalizedSymbol);
          if (agg && agg.trades.length > 0) {
            effectiveMultiplier = agg.trades[0].multiplier ?? 1;
          }
        }

        const assetType: 'stock' | 'option' =
          h ? (h.assetType ?? (effectiveMultiplier !== 1 ? 'option' : 'stock')) : (effectiveMultiplier !== 1 ? 'option' : 'stock');

        // [FIX] 计算盈亏平衡点 (Break-even Price)
        // 公式：J = |(accTotalCost - accRealizedPNL) / netQty|
        // accTotalCost: 多头为正 costBasis，空头为负 costBasis
        // accTotalCost: 多头为正 costBasis，空头为负 costBasis
        const rawCostBasis = h ? (h.costBasis ?? 0) : 0;
        const realizedPnl = h ? (h.realizedPnl ?? 0) : 0;
        const isLong = netQty > 0;
        const accTotalCost = isLong ? rawCostBasis : -rawCostBasis;

        let breakEvenPrice: number | null = null;
        if (netQty !== 0) {
          breakEvenPrice = Math.abs((accTotalCost - realizedPnl) / (netQty * multiplier));
        }

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

        const priceStatus: RtStatus | undefined =
          priceRecord && typeof priceRecord.status === 'string'
            ? (priceRecord.status as RtStatus)
            : undefined;

        const mv = last !== null ? netQty * multiplier * last : null;
        const costBasis =
          avgCost !== null ? netQty * multiplier * avgCost : null;
        const pnl =
          mv !== null && costBasis !== null ? mv - costBasis : null;
        const pnlPct =
          pnl !== null && costBasis !== null && costBasis !== 0
            ? pnl / Math.abs(costBasis)
            : null;

        // [NEW] Total Lifetime PnL = AccRealizedPnL + UnrealizedPnL
        const totalLifetimePnL = pnl !== null ? realizedPnl + pnl : null;

        if (netQty !== 0) {
          if (last === null) {
            gmvMissing = true;
          } else {
            const grossMv = Math.abs(netQty) * multiplier * last;
            totalGrossMv += grossMv;
            hasGrossMv = true;
          }
        }

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

        if (netQty !== 0 && (mv === null || costBasis === null)) {
          pnlMissing = true;
        }

        const dailyAgg = dailyTxAggregates.get(normalizedSymbol);
        const todaysTrades = dailyAgg?.trades ?? [];

        const refDateUsed = prevNyTradingDayString(getEffectiveTradingDay(now));

        const {
          todayPl,
          todayPlStatus,
          refPrice,
          prevClose,
        } = computeDayPnLSymbol(
          { netQty, multiplier: effectiveMultiplier },
          marketSession,
          isTradingDay,
          lastPriceData,
          refEodMap[normalizedSymbol],
          todayEodMap[normalizedSymbol],
          todaysTrades,
          refDateUsed,
        );

        // Accumulate Total Today PnL
        if (todayPl !== null) {
          totalTodayPl += todayPl;
          allStatuses.push(todayPlStatus);
        } else {
          // If any single position is missing PnL, the total is degraded?
          // Or just skip? Usually degraded.
          allStatuses.push(todayPlStatus);
        }

        // Accumulate Total Realized PnL (from FIFO)
        if (h) {
          totalRealizedPnl += h.realizedPnl ?? 0;
        }

        let dayChange: number | null = null;
        let dayChangePct: number | null = null;
        let todayPlPct: number | null = null; // Defined here

        if (todayPl !== null && costBasis !== null && costBasis !== 0) {
          todayPlPct = todayPl / Math.abs(costBasis);
        }
        if (
          todayPl !== null &&
          typeof refPrice === 'number' &&
          typeof prevClose === 'number' &&
          Number.isFinite(refPrice) &&
          Number.isFinite(prevClose) &&
          prevClose !== 0
        ) {
          dayChange = refPrice - prevClose;
          dayChangePct = dayChange / prevClose;
        }

        if (mv !== null) totalMv += mv;
        if (pnl !== null) totalPnl += pnl;


        // Accumulate realized PnL
        totalRealizedPnl += realizedPnl;

        // Count positions (non-zero holdings)
        if (netQty !== 0) positionsCount++;

        const anomalies: string[] = h && Array.isArray(h.anomalies)
          ? (h.anomalies as string[])
          : [];

        return {
          symbol,
          assetType,
          netQty,
          avgCost,
          breakEvenPrice,
          multiplier,
          last,
          mv,
          pnl,
          pnlPct,
          totalLifetimePnL, // [NEW]
          todayPl,
          todayPlPct,
          todayPlStatus,
          dayChange,
          dayChangePct,
          dayQtyDelta: dailyAgg?.dayQtyDelta ?? 0,
          dayNotional: dailyAgg?.dayNotional ?? 0,
          priceStatus,
          anomalies,
          refPrice,
          prevClose,
          refDateUsed,
        };
      });

      const statusSet = new Set(allStatuses);
      let aggTodayPlStatus: AggTodayStatus;

      const hasLiveOrClosed = allStatuses.some(
        (s) => s === 'live' || s === 'closed',
      );

      if (hasLiveOrClosed) {
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

      let gmvStatus: AggTodayStatus;
      if (!hasGrossMv) {
        gmvStatus = 'degraded';
      } else if (gmvMissing) {
        gmvStatus = 'stale-last';
      } else {
        gmvStatus = baseSessionStatus;
      }

      let nciStatus: AggTodayStatus;
      if (!hasNci || nciMissing) {
        nciStatus = 'degraded';
      } else {
        nciStatus = baseSessionStatus;
      }

      let pnlStatus: AggTodayStatus;
      if (!hasGrossMv || !hasNci || pnlMissing) {
        pnlStatus = 'degraded';
      } else {
        pnlStatus = baseSessionStatus;
      }

      // Calculate average position size
      const avgPositionSize = positionsCount > 0 && finalTotalGrossMv !== null
        ? finalTotalGrossMv / positionsCount
        : null;

      // Simple calculations for new metrics
      const totalTradeCount = Array.isArray(transactions) ? transactions.length : 0;

      // Calculate today's trade count
      let todayTradeCount = 0;
      if (Array.isArray(transactions)) {
        // ★ [FIX] Use getEffectiveTradingDay() for consistency with PnL
        const todayNy = getEffectiveTradingDay();
        todayTradeCount = transactions.filter(tx => {
          const ts = tx.transactionTimestamp;
          return typeof ts === 'number' && toNyCalendarDayString(ts) === todayNy;
        }).length;
      }

      // Calculate PnL Metrics using independent algorithm modules
      const todayNy = getEffectiveTradingDay();
      const periodStarts = getPeriodStartDates(todayNy);
      const periodBaseDates = getPeriodBaseDates(todayNy);

      // Helper to calculate Historical Unrealized PnL
      const calcHistoricalUnrealized = (
        baseDate: string,
        priceMap: Record<string, OfficialCloseResult>
      ): number => {
        // 1. Filter transactions up to baseDate (inclusive)
        // Note: transactionTimestamp is ms, baseDate is YYYY-MM-DD.
        // We include all trades that happened ON or BEFORE baseDate (NY Time).
        const txsUpToDate = (transactions || []).filter(tx => {
          const txDay = toNyCalendarDayString(tx.transactionTimestamp);
          return txDay <= baseDate;
        });

        // 2. Build Snapshot
        // [FIX] Do NOT pass baseDate as targetDate.
        // We want the snapshot to reflect "what I held then" but expressed in TODAY'S split-adjusted terms (shares & price).
        // Since historical prices from API are split-adjusted, our quantity must also be split-adjusted.
        // Passing no targetDate applies ALL splits (including future ones relative to baseDate), which is correct for matching adjusted prices.
        const { holdings } = buildHoldingsSnapshot(txsUpToDate);

        // 3. Calculate Unrealized PnL
        let totalUnrealized = 0;
        for (const h of holdings) {
          const sym = normalizeSymbolForClient(h.symbol);
          const closeRes = priceMap[sym];
          const price = closeRes?.status === 'ok' ? closeRes.close : null;

          if (price != null && h.netQty !== 0) {
            const mv = h.netQty * price * h.multiplier;
            const cost = h.costBasis;
            totalUnrealized += (mv - cost);
          }
        }
        return totalUnrealized;
      };

      // Calculate Base Unrealized PnL for each period
      const wtdBaseUnrealized = calcHistoricalUnrealized(periodBaseDates.wtd, wtdBaseEodMap);
      const mtdBaseUnrealized = calcHistoricalUnrealized(periodBaseDates.mtd, mtdBaseEodMap);
      const ytdBaseUnrealized = calcHistoricalUnrealized(periodBaseDates.ytd, ytdBaseEodMap);

      // Current Total Unrealized (from current holdings calculation above)
      // Note: totalPnl calculated above IS the current Total Unrealized PnL (Market Value - Cost Basis)
      // Wait, 'totalPnl' in the loop above is actually "Total Unrealized PnL" (MV - Cost).
      // 'totalRealizedPnl' is separate.
      // So we can use 'totalPnl' (which accumulates 'pnl' from each row).
      const currentUnrealized = totalPnl;

      const { m5_1 } = calcM5_1_Trading({ transactions: transactions || [], todayNy });
      const { m4, m5_2, pnlEvents, totalRealizedPnl: m9_totalRealized, winCount, lossCount } = calcGlobalFifo({ transactions: transactions || [], todayNy });

      // M11-M13: Independent Calculations with New Formula
      // M = Sum(Realized Flow) + (Current Unrealized - Base Unrealized)
      const wtdPnl = calcM11_Wtd(pnlEvents, periodStarts.wtd, currentUnrealized, wtdBaseUnrealized);
      const mtdPnl = calcM12_Mtd(pnlEvents, periodStarts.mtd, currentUnrealized, mtdBaseUnrealized);
      const ytdPnl = calcM13_Ytd(pnlEvents, periodStarts.ytd, currentUnrealized, ytdBaseUnrealized);

      // Map to Summary Fields
      // M4: Today's Realized PnL (Historical)
      const m4_historicalRealized = m4;

      // M5.1: Trading Perspective
      const m5_1_trading = m5_1;

      // M5.2: Ledger Perspective
      const m5_2_ledger = m5_2;

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
          pnlStatus: aggTodayPlStatus,
          totalRealizedPnl,
          totalUnrealizedPnl: finalTotalPnl,
          totalLifetimePnl:
            finalTotalPnl !== null ? totalRealizedPnl + finalTotalPnl : null,
          positionsCount,
          avgPositionSize:
            positionsCount > 0 && finalTotalMv !== null
              ? finalTotalMv / positionsCount
              : null,
          // New metrics
          todayRealizedPnlHistorical: m4_historicalRealized, // Keep for backward compat if needed, or remove
          todayTradingPnlIntraday: m5_2_ledger, // Default to M5.2 for generic "Intraday"
          todayTradingPnlIntradayM5_1: m5_1_trading,
          todayTradingPnlIntradayM5_2: m5_2_ledger,

          // Explicit M4/M5 fields
          m4_historicalRealized,
          m5_1_trading,
          m5_2_ledger,

          todayTradeCount: dailyTxAggregates.size, // Approximation
          totalTradeCount: transactions ? transactions.length : 0,
          todayTradeCounts: (() => {
            const counts = { buy: 0, sell: 0, short: 0, cover: 0, total: 0 };
            if (Array.isArray(transactions)) {
              const todayNy = getEffectiveTradingDay();
              const todayTxs = transactions.filter(tx => {
                const ts = tx.transactionTimestamp;
                return typeof ts === 'number' && toNyCalendarDayString(ts) === todayNy;
              });

              counts.total = todayTxs.length;
              for (const tx of todayTxs) {
                const k = tx.opKind;
                if (k === 'BUY' || k === 'BTO') counts.buy++;
                else if (k === 'SELL' || k === 'STC') counts.sell++;
                else if (k === 'SHORT' || k === 'STO') counts.short++;
                else if (k === 'COVER' || k === 'BTC') counts.cover++;
              }
            }
            return counts;
          })(),
          // M8: Total Transaction Count (Cumulative)
          totalTradeCounts: (() => {
            const counts = { buy: 0, sell: 0, short: 0, cover: 0, total: 0 };
            if (Array.isArray(transactions)) {
              counts.total = transactions.length;
              for (const tx of transactions) {
                const k = tx.opKind;
                if (k === 'BUY' || k === 'BTO') counts.buy++;
                else if (k === 'SELL' || k === 'STC') counts.sell++;
                else if (k === 'SHORT' || k === 'STO') counts.short++;
                else if (k === 'COVER' || k === 'BTC') counts.cover++;
              }
            }
            return counts;
          })(),
          // M9: Total Historical Realized PnL (from Global FIFO)
          totalHistoricalRealizedPnl: m9_totalRealized,

          // M10: Win Rate (from Global FIFO)
          winRateStats: {
            winCount,
            lossCount,
            winRate: (winCount + lossCount) > 0 ? winCount / (winCount + lossCount) : 0,
          },
          wtdWinRateStats: (() => {
            const wtdEvents = pnlEvents.filter(e => e.date >= periodStarts.wtd);
            let w = 0, l = 0;
            for (const e of wtdEvents) {
              if (e.pnl > 0.0001) w++;
              else if (e.pnl < -0.0001) l++;
            }
            return { winCount: w, lossCount: l, winRate: (w + l) > 0 ? w / (w + l) : 0 };
          })(),
          mtdWinRateStats: (() => {
            const mtdEvents = pnlEvents.filter(e => e.date >= periodStarts.mtd);
            let w = 0, l = 0;
            for (const e of mtdEvents) {
              if (e.pnl > 0.0001) w++;
              else if (e.pnl < -0.0001) l++;
            }
            return { winCount: w, lossCount: l, winRate: (w + l) > 0 ? w / (w + l) : 0 };
          })(),

          wtdTradeCounts: (() => {
            const counts = { buy: 0, sell: 0, short: 0, cover: 0, total: 0 };
            if (Array.isArray(transactions)) {
              const wtdTxs = transactions.filter(tx => {
                const ts = tx.transactionTimestamp;
                return typeof ts === 'number' && toNyCalendarDayString(ts) >= periodStarts.wtd;
              });
              counts.total = wtdTxs.length;
              for (const tx of wtdTxs) {
                const k = tx.opKind;
                if (k === 'BUY' || k === 'BTO') counts.buy++;
                else if (k === 'SELL' || k === 'STC') counts.sell++;
                else if (k === 'SHORT' || k === 'STO') counts.short++;
                else if (k === 'COVER' || k === 'BTC') counts.cover++;
              }
            }
            return counts;
          })(),

          mtdTradeCounts: (() => {
            const counts = { buy: 0, sell: 0, short: 0, cover: 0, total: 0 };
            if (Array.isArray(transactions)) {
              const mtdTxs = transactions.filter(tx => {
                const ts = tx.transactionTimestamp;
                return typeof ts === 'number' && toNyCalendarDayString(ts) >= periodStarts.mtd;
              });
              counts.total = mtdTxs.length;
              for (const tx of mtdTxs) {
                const k = tx.opKind;
                if (k === 'BUY' || k === 'BTO') counts.buy++;
                else if (k === 'SELL' || k === 'STC') counts.sell++;
                else if (k === 'SHORT' || k === 'STO') counts.short++;
                else if (k === 'COVER' || k === 'BTC') counts.cover++;
              }
            }
            return counts;
          })(),

          winRate: null, // Legacy field, replaced by winRateStats
          wtdPnl,
          mtdPnl,
          ytdPnl,
        },
      };
    },
    [baseHoldings, dailyTxAggregates, refEodMap, todayEodMap, wtdBaseEodMap, mtdBaseEodMap, ytdBaseEodMap, transactions, getPriceRecord],
  );

  const loading = txLoading || eodLoading;
  return { rows, summary, loading };
}