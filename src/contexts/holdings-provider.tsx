'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useUser } from '@/firebase';
import { useUserTransactions, type Tx } from '@/hooks/use-user-transactions';
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import {
    nowNyCalendarDayString,
    toNyCalendarDayString,
    nyWeekdayIndex,
    toNyHmsString,
    US_MARKET_HOLIDAYS,
    prevNyTradingDayString,
    getEffectiveTradingDay,
    getPeriodStartDates,
    getPeriodBaseDates,
    getLastTradingDayOfYear, // [NEW]
} from '@/lib/ny-time';
import {
    getOfficialCloses,
    getOfficialClosesRange,
    type OfficialCloseResult,
    getOfficialClosesBatch,
} from '@/lib/data/official-close-repo';
import { useRealTimePrices } from '@/price/useRealTimePrices';
import { calcM5_1_Trading } from '@/lib/pnl/calc-m5-1-trading';
import { calcGlobalFifo, AuditEvent } from '@/lib/pnl/calc-m4-m5-2-global-fifo';
import { calcM11_Wtd } from '@/lib/pnl/calc-m11-wtd';
import { calcM12_Mtd } from '@/lib/pnl/calc-m12-mtd';
import { calcM13_Ytd } from '@/lib/pnl/calc-m13-ytd';
import { calcM6Attribution } from '@/lib/pnl/calc-m6-attribution';
import { calcM14DailyCalendar, DailyPnlResult } from '@/lib/pnl/calc-m14-daily-calendar';
import { eachDayOfInterval } from 'date-fns';
import { getActiveSymbols } from '@/lib/holdings/active-symbols'; // [NEW]

// —— 日内盈亏状态枚举
export type DayPlStatus =
    | 'live'
    | 'closed'
    | 'session-pre'
    | 'session-post'
    | 'missing-ref-eod'
    | 'missing-today-eod'
    | 'pending-eod-fetch'
    | 'stale-last'
    | 'degraded';

export type AggTodayStatus =
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

// Helper to transform EOD map from { Symbol: Result } to { Date_Symbol: Result }
// This is critical for calcM14DailyCalendar which expects composite keys.
function rekeyEodMap(
    sourceMap: Record<string, OfficialCloseResult>,
    dateStr: string
): Record<string, OfficialCloseResult> {
    const out: Record<string, OfficialCloseResult> = {};
    for (const [sym, res] of Object.entries(sourceMap)) {
        // Ensure we use the normalized symbol in the key
        const normSym = normalizeSymbolForClient(sym);
        const key = `${dateStr}_${normSym}`;
        out[key] = res;
    }
    return out;
}

// —— 安全合并策略 (Safe Merge Strategy) ——
// 逻辑：以 higherPriorityMap 为主，只有当 higherPriorityMap 缺失或无效时，才采纳 lowerPriorityMap 的数据。
// 即使 lowerPriorityMap 有数据，只要 higherPriorityMap 明确有 "status: ok" 的数据，就保留 higherPriorityMap 的。
// 主要是为了防止 "YTD Bulk Fetch" (Range) 的数据（可能稍旧或不完整）覆盖了 "Today/Ref Fetch" (Single) 的高保真数据。
function safeMergeEodMaps(
    lowerPriorityMap: Record<string, OfficialCloseResult>,
    higherPriorityMap: Record<string, OfficialCloseResult>
): Record<string, OfficialCloseResult> {
    // 1. Start with lower priority data (e.g. Range Data)
    const result = { ...lowerPriorityMap };

    // 2. Overlay higher priority data (e.g. Single Fetch Data), but be smart
    for (const [key, highVal] of Object.entries(higherPriorityMap)) {
        const lowVal = result[key];

        // condition A: High is OK -> Always take High
        if (highVal.status === 'ok') {
            result[key] = highVal;
            continue;
        }

        // condition B: High is NOT OK, but Low IS OK -> Keep Low (do nothing)
        if (lowVal?.status === 'ok') {
            continue; // Keep lowVal
        }

        // condition C: Both are not OK -> Take High (updates error/pending status)
        result[key] = highVal;
    }
    return result;
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
    totalLifetimePnL?: number | null;
    refPrice?: number | null;
    prevClose?: number | null;
    refDateUsed?: string;
    realizedPnl?: number | null;
    lots?: { qty: number; price: number; ts: number }[]; // [NEW]
    lastUpdatedTs?: number; // [NEW] Timestamp of the price
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
    todayRealizedPnlHistorical: number | null;
    todayTradingPnlIntraday: number | null;
    todayTradingPnlIntradayM5_1: number | null;
    todayTradingPnlIntradayM5_2: number | null;
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
        avgWin: number;
        avgLoss: number;
        pnlRatio: number;
        expectancy: number;
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
    m4_historicalRealized: number | null;
    m4_auditTrail?: AuditEvent[];
    m5_auditTrail?: AuditEvent[]; // [NEW] Detail for M5.1/M5.2
    m5_1_breakdown?: { symbol: string; realized: number; unrealized: number; total: number }[]; // [NEW] Detail for M5.1
    m5_1_auditTrail?: AuditEvent[]; // [NEW] Detailed Audit Trail for M5.1
    m5_2_breakdown?: { symbol: string; realized: number; unrealized: number; total: number }[]; // [NEW] Detail for M5.2
    m5_2_auditTrail?: AuditEvent[]; // [NEW] Detailed Audit Trail for M5.2
    m5_1_trading: number | null;
    m5_2_ledger: number | null;
    m6_1_legacy: number | null;
    m6_2_new: number | null;
    m6_total: number | null;
    m6_pnl_breakdown?: { symbol: string; realized: number; unrealized: number; total: number }[]; // [NEW] Detail for M6
    totalHistoricalRealizedPnl: number | null;
}

interface HoldingsContextValue {
    rows: HoldingRow[];
    summary: HoldingsSummary;
    historicalPnl: { symbol: string; pnl: number }[];
    dailyPnlList: { date: string; pnl: number }[];
    dailyPnlResults: Record<string, DailyPnlResult>;
    pnlEvents?: any[];
    loading: boolean;
    isCalculating: boolean; // [NEW] Explicit calculation state
    transactions: Tx[];     // [NEW] Raw Transactions exposed
    fullEodMap: Record<string, OfficialCloseResult>; // [NEW] Exposed for forensic tools
    refreshData: () => void;
    analysisYear: number; // [NEW]
    setAnalysisYear: (y: number) => void; // [NEW]
}


const HoldingsContext = createContext<HoldingsContextValue | null>(null);

export function HoldingsProvider({ children }: { children: React.ReactNode }) {
    const { user } = useUser();
    const { data: allTransactions, loading: txLoading } = useUserTransactions(user?.uid);
    const [analysisYear, setAnalysisYear] = useState<number>(new Date().getFullYear()); // Default to Current Year

    // [NEW] Determine Effective Date based on Analysis Year
    const effectiveTodayNy = useMemo(() => {
        const currentYear = new Date().getFullYear();
        // If analyzing a past year, clamp to Dec 31 of that year (or last trading day)
        // Treat 0 (All Time) as Current Year for Time Travel purposes (don't clamp)
        if (analysisYear > 0 && analysisYear < currentYear) {
            const lastDay = getLastTradingDayOfYear(analysisYear);
            console.log(`[HoldingsProvider] Time Travel Active: ${analysisYear} -> ${lastDay}`);
            return lastDay;
        }
        // Otherwise use live effective day
        return nowNyCalendarDayString();
    }, [analysisYear]);

    // [NEW] Filter Transactions for Time Travel
    const transactions = useMemo(() => {
        if (!allTransactions) return [];
        // Since transactionTimestamp includes time, we compare date string YYYY-MM-DD.
        // We include all transactions up to the END of the effective day.
        // Note: transactionTimestamp is MS.
        return allTransactions.filter(tx => {
            const txDay = toNyCalendarDayString(tx.transactionTimestamp);
            return txDay <= effectiveTodayNy;
        });
    }, [allTransactions, effectiveTodayNy]);

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

        // [FIX] Use effectiveTodayNy instead of now
        const baseDay = effectiveTodayNy;

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
    }, [transactions, effectiveTodayNy]);

    // ... (in HoldingsProvider)

    const uniqueSymbols = useMemo(() => {
        if (!transactions || transactions.length === 0) return [];

        // [OPTIMIZED] Fetch only symbols active YTD (Start of Year -> Effective Today)
        // This ensures M13 YTD PnL calculations have all necessary EODs, 
        // while ignoring symbols closed in previous years.
        const { ytd: ytdStart } = getPeriodStartDates(effectiveTodayNy);

        // Note: active-symbols logic handles "Held at Start" correctly by replaying history.
        return getActiveSymbols(transactions, ytdStart, effectiveTodayNy);
    }, [transactions, effectiveTodayNy]);

    const { get: getPriceRecord, snapshot: priceSnapshot } = useRealTimePrices(uniqueSymbols);

    const [refEodMap, setRefEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [todayEodMap, setTodayEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [wtdBaseEodMap, setWtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [mtdBaseEodMap, setMtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [ytdBaseEodMap, setYtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [mtdEodMap, setMtdEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [eodLoading, setEodLoading] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);

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
            // [FIX] Use effectiveTodayNy instead of current date
            const baseDay = effectiveTodayNy;
            const refDay = prevNyTradingDayString(baseDay);
            const { wtd: wtdBase, mtd: mtdBase, ytd: ytdBase } = getPeriodBaseDates(baseDay);

            try {
                const symbolsNorm = uniqueSymbols.map(normalizeSymbolForClient);
                // console.log(`[HoldingsProvider] Fetching EOD For: ${baseDay} (Ref: ${refDay})`);

                const [refCloses, todayCloses, wtdBaseCloses, mtdBaseCloses, ytdBaseCloses] = await Promise.all([
                    getOfficialCloses(refDay, symbolsNorm),
                    getOfficialCloses(baseDay, symbolsNorm),
                    getOfficialCloses(wtdBase, symbolsNorm),
                    getOfficialCloses(mtdBase, symbolsNorm),
                    getOfficialCloses(ytdBase, symbolsNorm),
                ]);

                if (cancelled) return;

                setRefEodMap(refCloses);
                setTodayEodMap(todayCloses);
                setWtdBaseEodMap(wtdBaseCloses);
                setMtdBaseEodMap(mtdBaseCloses);
                setYtdBaseEodMap(ytdBaseCloses);

                // [NEW] Robust Date Generation (Avoid time zone shifts)
                // Use explicit Noon UTC construction to safely map to NY Date Strings
                const { mtd: mtdStartStr, ytd: ytdStartStr } = getPeriodStartDates(baseDay);

                // Use robust ranges based on effectiveTodayNy
                const ytdEndDate = baseDay;

                // MTD Robust Range (Month of Effective Day)
                const mtdRange = eachDayOfInterval({
                    start: new Date(`${mtdStartStr}T12:00:00Z`),
                    end: new Date(`${baseDay}T12:00:00Z`)
                }).map(d => toNyCalendarDayString(d));

                // YTD Range (Year of Effective Day)
                // If it's time travel, we want YTD up to effective day.
                // We use getOfficialClosesRange for bulk YTD efficiency.

                const [rangeResults, mtdRobustResults] = await Promise.all([
                    getOfficialClosesRange(ytdStartStr, ytdEndDate, symbolsNorm),
                    getOfficialClosesBatch(mtdRange, symbolsNorm)
                ]);

                // Merge: Existing -> Range (YTD) -> Robust (MTD)
                setMtdEodMap(prev => {
                    let next = safeMergeEodMaps(prev, rangeResults);
                    next = safeMergeEodMaps(next, mtdRobustResults);
                    return next;
                });

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
    }, [uniqueSymbols, refreshVersion, effectiveTodayNy]); // Added effectiveTodayNy

    // [PERFORMANCE FIX] Phase 1: Isolate M14 Heavy Calculation

    // 1. Construct Full EOD Map (Hoisted for external use)
    const fullEodMap = useMemo(() => {
        const todayNy = effectiveTodayNy; // [FIX]
        const refDateUsed = prevNyTradingDayString(todayNy);
        const periodBaseDates = getPeriodBaseDates(todayNy);

        let combinedEod = { ...mtdEodMap };

        const specificMaps = [
            rekeyEodMap(ytdBaseEodMap, periodBaseDates.ytd),
            rekeyEodMap(mtdBaseEodMap, periodBaseDates.mtd),
            rekeyEodMap(wtdBaseEodMap, periodBaseDates.wtd),
            rekeyEodMap(refEodMap, refDateUsed),
            rekeyEodMap(todayEodMap, todayNy)
        ];

        for (const map of specificMaps) {
            combinedEod = safeMergeEodMaps(combinedEod, map);
        }
        return combinedEod;
    }, [
        mtdEodMap,
        ytdBaseEodMap,
        mtdBaseEodMap,
        wtdBaseEodMap,
        refEodMap,
        todayEodMap,
        effectiveTodayNy // Added dependency
    ]);

    // 2. Perform M14 Calculation
    const memoizedM14BaseResults = useMemo(() => {
        const todayNy = effectiveTodayNy; // [FIX]
        // [FIX] Consistent Date Generation (Noon UTC)
        const { ytd: ytdStartStr } = getPeriodStartDates(todayNy);
        const ytdRange = eachDayOfInterval({
            start: new Date(`${ytdStartStr}T12:00:00Z`),
            end: new Date(`${todayNy}T12:00:00Z`)
        });
        const ytdTargetDates = ytdRange.map(d => toNyCalendarDayString(d));

        // Ensure we explicitly include the "Base Dates"
        const periodBaseDates = getPeriodBaseDates(todayNy);
        const refDateUsed = prevNyTradingDayString(todayNy);

        const extraDates = [
            periodBaseDates.ytd,
            periodBaseDates.mtd,
            periodBaseDates.wtd,
            refDateUsed
        ].filter(d => !ytdTargetDates.includes(d) && d < todayNy).sort();

        const allTargets = Array.from(new Set([...extraDates, ...ytdTargetDates])).sort();

        return calcM14DailyCalendar(transactions || [], allTargets, fullEodMap);
    }, [
        transactions,
        fullEodMap,
        effectiveTodayNy // Added dependency
    ]);

    const { rows, summary, historicalPnl, dailyPnlList, dailyPnlResults, pnlEvents } = useMemo(
        (): { rows: HoldingRow[]; summary: HoldingsSummary; historicalPnl: { symbol: string; pnl: number }[]; dailyPnlList: { date: string; pnl: number }[]; dailyPnlResults: Record<string, DailyPnlResult>; pnlEvents: any[] } => {
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
            const currentRealTimeNy = toNyCalendarDayString(now);
            // [NEW] Check if we are in Time Travel mode
            const isHistoricalView = effectiveTodayNy < currentRealTimeNy;

            // If historical, strictly 'closed'. Use effective lookup for trading day check?
            // Actually relying on effectiveTodayNy is enough.
            const marketSession = isHistoricalView ? 'closed' : getNyMarketSessionLocal(now);

            // isTradingDay logic: If historical, we treat as closed for "status" purposes?
            // Or if analysis date IS a trading day, we just show closed EOD.
            const isTradingDay = !isHistoricalView && (!US_MARKET_HOLIDAYS.has(currentRealTimeNy) && nyWeekdayIndex(now) > 0 && nyWeekdayIndex(now) < 6);

            const allSymbols = new Set<string>();
            baseHoldings.forEach((h: any) => allSymbols.add(normalizeSymbolForClient(h.symbol)));
            dailyTxAggregates.forEach((_, key) => allSymbols.add(key));

            const rows: HoldingRow[] = Array.from(allSymbols).map((symbolKey): HoldingRow => {
                const h = baseHoldings.find((h: any) => normalizeSymbolForClient(h.symbol) === symbolKey);

                const symbol = h ? h.symbol : symbolKey;
                const normalizedSymbol = symbolKey;
                const netQty: number = h ? (h.netQty ?? 0) : 0;
                const avgCost: number | null = h ? (h.costPerUnit ?? null) : null;
                const multiplier: number = h ? (h.multiplier ?? 1) : 1;

                let effectiveMultiplier = multiplier;
                if (!h) {
                    const agg = dailyTxAggregates.get(normalizedSymbol);
                    if (agg && agg.trades.length > 0) {
                        effectiveMultiplier = agg.trades[0].multiplier ?? 1;
                    }
                }

                const assetType: 'stock' | 'option' =
                    h ? (h.assetType ?? (effectiveMultiplier !== 1 ? 'option' : 'stock')) : (effectiveMultiplier !== 1 ? 'option' : 'stock');

                const rawCostBasis = h ? (h.costBasis ?? 0) : 0;
                const realizedPnl = h ? (h.realizedPnl ?? 0) : 0;
                const isLong = netQty > 0;
                const accTotalCost = isLong ? rawCostBasis : -rawCostBasis;

                let breakEvenPrice: number | null = null;
                if (netQty !== 0) {
                    breakEvenPrice = Math.abs((accTotalCost - realizedPnl) / (netQty * multiplier));
                }

                // [FIX] Determine LAST price Logic
                const priceRecord = getPriceRecord(normalizedSymbol);
                let last: number | null = null;
                let priceStatus: RtStatus | undefined = undefined;
                let lastUpdatedTs: number | undefined = undefined;

                if (isHistoricalView) {
                    // Historical Mode: Use EOD of effective date
                    const eod = todayEodMap[normalizedSymbol];
                    if (eod?.status === 'ok' && eod.close != null) {
                        last = eod.close;
                        priceStatus = 'closed';
                    } else {
                        // If missing EOD in history, check previous? Or leave null.
                        last = null;
                        priceStatus = 'stale'; // Indicates data missing for that date
                    }
                } else {
                    // Live Mode: Use RealTime Prices
                    last = priceRecord && typeof priceRecord.price === 'number' && Number.isFinite(priceRecord.price)
                        ? priceRecord.price
                        : null;
                    priceStatus = priceRecord && typeof priceRecord.status === 'string'
                        ? (priceRecord.status as RtStatus)
                        : undefined;
                    lastUpdatedTs = priceRecord?.ts;
                }

                const lastPriceData =
                    (!isHistoricalView && priceRecord != null)
                        ? { price: priceRecord.price, ts: priceRecord.ts }
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

                // Ref Date: Typically yesterday of effectiveTodayNy
                const refDateUsed = prevNyTradingDayString(effectiveTodayNy);

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

                if (todayPl !== null) {
                    totalTodayPl += todayPl;
                    allStatuses.push(todayPlStatus);
                } else {
                    allStatuses.push(todayPlStatus);
                }

                // ... (rest of row assembly)
                if (h) {
                    totalRealizedPnl += h.realizedPnl ?? 0;
                }

                let dayChange: number | null = null;
                let dayChangePct: number | null = null;
                let todayPlPct: number | null = null;

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

                // Accumulate totalRealized (redundant check but safe)
                // Wait, totalRealizedPnl is accumulated at line 750 (original)
                // Need to remove this or keep? The original code accumulated h.realizedPnl twice if logic bad.
                // The original code: line 725 `if(h) totalRealized += ...`
                // AND line 750 `totalRealizedPnl += realizedPnl;`
                // `realizedPnl` var is `h ? h.realized : 0`.
                // So it was double counting?!
                // Let's look at original code Step 1581 line 725 and 750.
                // Line 725: if(h) totalRealizedPnl += h.realizedPnl
                // Line 750: totalRealizedPnl += realizedPnl
                // Yes, it looks like double counting!
                // But I should fix this here.
                // I will ONLY use line 750 equivalent.

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
                    totalLifetimePnL,
                    realizedPnl,
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
                    lastUpdatedTs,
                    lots: h?.lots || [],
                };
            }).filter((r) => {
                if (r.netQty !== 0) return true;
                if (r.todayPl !== null && Math.abs(r.todayPl) > 0.001) return true;
                return false;
            });

            // ... (rest of summary) ...
            // Need to reconstruct the rest of summary logic because I replaced the whole block?
            // The replace block covers `rows` map. If I stop replace here, I must ensure valid JS.




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

            const avgPositionSize = positionsCount > 0 && finalTotalGrossMv !== null
                ? finalTotalGrossMv / positionsCount
                : null;

            const totalTradeCount = Array.isArray(transactions) ? transactions.length : 0;

            let todayTradeCount = 0;
            if (Array.isArray(transactions)) {
                const todayNy = getEffectiveTradingDay();
                todayTradeCount = transactions.filter(tx => {
                    const ts = tx.transactionTimestamp;
                    return typeof ts === 'number' && toNyCalendarDayString(ts) === todayNy;
                }).length;
            }

            const todayNy = effectiveTodayNy;
            const refDateUsed = prevNyTradingDayString(todayNy);
            const periodStarts = getPeriodStartDates(todayNy);
            const periodBaseDates = getPeriodBaseDates(todayNy);

            console.log('[HoldingsProvider] Date Debug:', {
                now: new Date().toISOString(),
                todayNy,
                periodStarts,
                periodBaseDates,
                isEffectiveFn: getEffectiveTradingDay === undefined ? 'missing' : 'present'
            });

            // [PERFORMANCE FIX] Use pre-calculated Unrealized PnL from M14 (dailyPnlResults)
            // instead of running buildHoldingsSnapshot 3 times.
            const getCachedUnrealized = (date: string): number => {
                const res = memoizedM14BaseResults[date];
                if (res && typeof res.eodUnrealized === 'number') {
                    return res.eodUnrealized;
                }
                // Fallback: If date is not in our calendar range (e.g. very old), assume 0 or negligible for now.
                // Or if needed, we could fetch it, but that causes the lag.
                // Given we look back to YTD Base, returning 0 if missing is effectively saying "start from 0".
                return 0;
            };

            const wtdBaseUnrealized = getCachedUnrealized(periodBaseDates.wtd);
            const mtdBaseUnrealized = getCachedUnrealized(periodBaseDates.mtd);
            const ytdBaseUnrealized = getCachedUnrealized(periodBaseDates.ytd);

            console.log('[HoldingsProvider] YTD Diagnostic:', {
                todayNy,
                ytdBaseDate: periodBaseDates.ytd,
                ytdBaseUnrealized,
                hasBaseData: !!memoizedM14BaseResults[periodBaseDates.ytd],
                currentUnrealized: totalPnl
            });

            const currentUnrealized = totalPnl;

            // [FIX] Pass real-time prices to M5.1 to capture UNREALIZED intraday PnL
            const { m5_1, breakdown: m5_1_breakdown_map, auditTrail: m5_1_events } = calcM5_1_Trading({
                transactions: transactions || [],
                todayNy,
                currentPrices: priceSnapshot
            });

            const { m4, m5_2: m5_2_realized, pnlEvents, totalRealizedPnl: m9_totalRealized, winCount, lossCount, auditTrail, openPositions } = calcGlobalFifo({ transactions: transactions || [], todayNy });

            // [FIX] Calculate Unrealized PnL for M5.2 (Ledger View) for positions opened today
            let m5_2_unrealized = 0;
            const m5_2_events: AuditEvent[] = [];

            // 1. Add M5.2 Realized Events (Opened Today + Closed Today)
            // Filter global audit trail for events strictly within today
            auditTrail.forEach(e => {
                if (e.openDate === todayNy && e.closeDate === todayNy) {
                    m5_2_events.push(e);
                }
            });

            if (priceSnapshot && openPositions) {
                openPositions.forEach((queue, key) => {
                    // key is either contractKey or normalized symbol
                    // priceSnapshot is keyed by normalized symbol.
                    // Simplified matching:
                    const symbol = normalizeSymbolForClient(key.split(' ')[0]);
                    const priceRec = priceSnapshot.get(symbol);

                    if (priceRec && typeof priceRec.price === 'number') {
                        const currentPrice = priceRec.price;
                        queue.forEach(pos => {
                            // Only consider positions established TODAY for M5.2 Unrealized
                            if (pos.date === todayNy) {
                                let pnl = 0;
                                if (pos.qty > 0) { // Long
                                    pnl = (currentPrice - pos.cost) * pos.qty * pos.multiplier;
                                } else { // Short
                                    pnl = (pos.cost - currentPrice) * Math.abs(pos.qty) * pos.multiplier;
                                }
                                m5_2_unrealized += pnl;
                                m5_2_events.push({
                                    symbol: symbol,
                                    openDate: todayNy,
                                    openPrice: pos.cost,
                                    closeDate: "HOLDING",
                                    closePrice: currentPrice,
                                    qty: pos.qty,
                                    pnl: pnl,
                                    multiplier: pos.multiplier
                                });
                            }
                        });
                    }
                });
            }

            const m5_2 = m5_2_realized + m5_2_unrealized;

            // [NEW] Calculate All-Time Win Rate Stats
            let totalWinPnl = 0;
            let totalLossPnl = 0;
            (pnlEvents || []).forEach(e => {
                if (e.pnl > 0) totalWinPnl += e.pnl;
                if (e.pnl < 0) totalLossPnl += Math.abs(e.pnl);
            });
            const avgWin = winCount > 0 ? totalWinPnl / winCount : 0;
            const avgLoss = lossCount > 0 ? totalLossPnl / lossCount : 0;
            const pnlRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
            const totalCount = winCount + lossCount;
            const winRate = totalCount > 0 ? winCount / totalCount : 0;
            const lossRate = totalCount > 0 ? lossCount / totalCount : 0;
            const expectancy = (winRate * avgWin) - (lossRate * avgLoss);

            const historicalPnlMap = new Map<string, number>();
            for (const event of auditTrail) {
                const sym = normalizeSymbolForClient(event.symbol);
                const current = historicalPnlMap.get(sym) || 0;
                historicalPnlMap.set(sym, current + event.pnl);
            }
            const historicalPnl = Array.from(historicalPnlMap.entries()).map(([symbol, pnl]) => ({ symbol, pnl }));

            // [MOVED DOWN] dailyPnlList calculation moved after dailyPnlResults is finalized

            // [FIX] Extract a Robust Reference Map from the Full EOD Map
            // This ensures M6 (Homepage) uses the exact same data source as M14 (Calendar/Dialog),
            // covering cases where the simple 'refEodMap' fetch failed but 'mtd/ytd' bulk fetch succeeded.
            const robustRefMap: Record<string, OfficialCloseResult> = {};
            const refDateKey = prevNyTradingDayString(todayNy);

            allSymbols.forEach(sym => {
                const key = `${refDateKey}_${normalizeSymbolForClient(sym)}`;
                if (fullEodMap[key]) {
                    robustRefMap[sym] = fullEodMap[key];
                } else if (refEodMap[sym]) {
                    // Fallback to specific fetch if somehow missing in full map (unlikely due to merge logic)
                    robustRefMap[sym] = refEodMap[sym];
                }
            });

            // [MOVED UP] Calculate M6 Total first so we can inject it into M14
            const m6Results = calcM6Attribution(
                transactions || [],
                todayNy,
                robustRefMap // <--- USE ROBUST MAP
            );

            let m6_1 = 0;
            let m6_2 = 0;

            for (const sym in m6Results) {
                const res = m6Results[sym];
                m6_1 += res.m6_1_realized;
                m6_2 += res.m6_2_realized;

                const priceRec = getPriceRecord(normalizeSymbolForClient(sym));
                const currentPrice = priceRec?.price ?? null;

                if (currentPrice !== null) {
                    if (res.remainingLegacyQty !== 0 && res.status === 'ok') {
                        const prevClose = robustRefMap[normalizeSymbolForClient(sym)]?.close ?? 0;
                        m6_1 += res.remainingLegacyQty * (currentPrice - prevClose) * res.multiplier;
                    }

                    for (const batch of res.remainingNewBatches) {
                        m6_2 += batch.qty * (currentPrice - batch.price) * res.multiplier;
                    }
                }
            }
            const m6_total = m6_1 + m6_2;

            // [PERFORMANCE FIX] Use pre-calculated base results (isolated from real-time price ticks)
            const dailyPnlResults = { ...memoizedM14BaseResults };

            // Inject Today's M6
            if (m6_total !== null) {
                const todayRes = dailyPnlResults[todayNy] || {
                    date: todayNy,
                    totalPnl: 0,
                    realizedPnl: 0,
                    unrealizedPnlChange: 0,
                    eodUnrealized: 0,
                    prevEodUnrealized: 0,
                    status: 'missing-data'
                };

                // Calculate Realized PnL for Today from pnlEvents
                let todayRealizedPnl = 0;
                if (pnlEvents) {
                    pnlEvents.forEach(e => {
                        if (e.date === todayNy) {
                            todayRealizedPnl += e.pnl;
                        }
                    });
                }

                // Breakdown Realized PnL for Today into Position (Legacy) vs Day Trade
                let todayRealizedPosition = 0;
                let todayRealizedDay = 0;
                if (auditTrail) {
                    auditTrail.forEach(e => {
                        if (e.closeDate === todayNy) {
                            if (e.openDate < e.closeDate) {
                                todayRealizedPosition += e.pnl;
                            } else {
                                todayRealizedDay += e.pnl;
                            }
                        }
                    });
                }

                // Calculate Unrealized PnL Change for Today
                // Since Total = Realized + UnrealizedChange, then UnrealizedChange = Total - Realized
                const todayUnrealizedChange = m6_total - todayRealizedPnl;

                dailyPnlResults[todayNy] = {
                    ...todayRes,
                    totalPnl: m6_total,
                    realizedPnl: todayRealizedPnl,
                    realizedPnlPosition: todayRealizedPosition,
                    realizedPnlDay: todayRealizedDay,
                    m5_1: m5_1,
                    unrealizedPnlChange: todayUnrealizedChange,
                };
            }

            // [FIXED LOCATION] Calculate dailyPnlList from the FINAL dailyPnlResults (Total PnL)
            const dailyPnlList = Object.values(dailyPnlResults)
                .map(res => ({ date: res.date, pnl: res.totalPnl }))
                .sort((a, b) => a.date.localeCompare(b.date));

            // Calculate WTD/MTD using Sum of Dailies
            // Calculate WTD/MTD using Sum of Dailies
            // [FIX] Use strict NY Trading Day boundaries from ny-time (DRY)
            // periodStarts.wtd and mtd are already calculated using strict NY logic in getPeriodStartDates
            const m11 = calcM11_Wtd(
                dailyPnlResults,
                periodStarts.wtd,
                todayNy
            );

            const m12 = calcM12_Mtd(
                dailyPnlResults,
                periodStarts.mtd,
                todayNy
            );

            // [FIX] Update M13 to use Sum-of-Dailies method for perfect consistency with Calendar/WTD
            const m13 = calcM13_Ytd(
                dailyPnlResults,
                periodStarts.ytd,
                todayNy
            );

            // ... (keep existing logic for trade counts etc) ...
            const {
                buy: todayBuy, sell: todaySell, short: todayShort, cover: todayCover, total: todayTotal
            } = (transactions || []).reduce((acc, tx) => {
                const txDay = toNyCalendarDayString(tx.transactionTimestamp);
                if (txDay === todayNy) {
                    if (tx.opKind === 'BUY' || tx.opKind === 'BTO') acc.buy++;
                    else if (tx.opKind === 'SELL' || tx.opKind === 'STC') acc.sell++;
                    else if (tx.opKind === 'SHORT' || tx.opKind === 'STO') acc.short++;
                    else if (tx.opKind === 'COVER' || tx.opKind === 'BTC') acc.cover++;
                    acc.total++;
                }
                return acc;
            }, { buy: 0, sell: 0, short: 0, cover: 0, total: 0 });

            const {
                buy: totalBuy, sell: totalSell, short: totalShort, cover: totalCover, total: totalTotal
            } = (transactions || []).reduce((acc, tx) => {
                if (tx.opKind === 'BUY' || tx.opKind === 'BTO') acc.buy++;
                else if (tx.opKind === 'SELL' || tx.opKind === 'STC') acc.sell++;
                else if (tx.opKind === 'SHORT' || tx.opKind === 'STO') acc.short++;
                else if (tx.opKind === 'COVER' || tx.opKind === 'BTC') acc.cover++;
                acc.total++;
                return acc;
            }, { buy: 0, sell: 0, short: 0, cover: 0, total: 0 });

            const wtdTradeCounts = (transactions || []).reduce((acc, tx) => {
                const txDay = toNyCalendarDayString(tx.transactionTimestamp);
                if (txDay >= periodStarts.wtd) {
                    if (tx.opKind === 'BUY' || tx.opKind === 'BTO') acc.buy++;
                    else if (tx.opKind === 'SELL' || tx.opKind === 'STC') acc.sell++;
                    else if (tx.opKind === 'SHORT' || tx.opKind === 'STO') acc.short++;
                    else if (tx.opKind === 'COVER' || tx.opKind === 'BTC') acc.cover++;
                    acc.total++;
                }
                return acc;
            }, { buy: 0, sell: 0, short: 0, cover: 0, total: 0 });

            const mtdTradeCounts = (transactions || []).reduce((acc, tx) => {
                const txDay = toNyCalendarDayString(tx.transactionTimestamp);
                if (txDay >= periodStarts.mtd) {
                    if (tx.opKind === 'BUY' || tx.opKind === 'BTO') acc.buy++;
                    else if (tx.opKind === 'SELL' || tx.opKind === 'STC') acc.sell++;
                    else if (tx.opKind === 'SHORT' || tx.opKind === 'STO') acc.short++;
                    else if (tx.opKind === 'COVER' || tx.opKind === 'BTC') acc.cover++;
                    acc.total++;
                }
                return acc;
            }, { buy: 0, sell: 0, short: 0, cover: 0, total: 0 });

            // winRate is already calculated above

            const calcWinRateStats = (startDate: string) => {
                const { winCount, lossCount, pnlEvents, openPositions: globalOpenPositions } = calcGlobalFifo({
                    transactions: (transactions || []).filter(tx => toNyCalendarDayString(tx.transactionTimestamp) >= startDate),
                    todayNy
                });

                let totalWinPnl = 0;
                let totalLossPnl = 0;

                (pnlEvents || []).forEach(e => {
                    if (e.pnl > 0) totalWinPnl += e.pnl;
                    if (e.pnl < 0) totalLossPnl += Math.abs(e.pnl);
                });

                const avgWin = winCount > 0 ? totalWinPnl / winCount : 0;
                const avgLoss = lossCount > 0 ? totalLossPnl / lossCount : 0;
                const pnlRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
                const totalCount = winCount + lossCount;
                const winRate = totalCount > 0 ? winCount / totalCount : 0;
                const lossRate = totalCount > 0 ? lossCount / totalCount : 0;
                const expectancy = (winRate * avgWin) - (lossRate * avgLoss);

                return {
                    winCount,
                    lossCount,
                    winRate,
                    avgWin,
                    avgLoss,
                    pnlRatio,
                    expectancy
                };
            };

            const wtdWinRateStats = calcWinRateStats(periodStarts.wtd);
            const mtdWinRateStats = calcWinRateStats(periodStarts.mtd);

            const finalSummary: HoldingsSummary = {
                totalMv: finalTotalMv,
                totalPnl: finalTotalPnl,
                totalTodayPl: finalTotalTodayPl,
                aggTodayPlStatus,
                totalGrossMv: finalTotalGrossMv,
                totalNci: finalTotalNci,
                gmvStatus,
                nciStatus,
                pnlStatus,
                totalRealizedPnl: totalRealizedPnl,
                totalUnrealizedPnl: finalTotalPnl,
                totalLifetimePnl: (totalRealizedPnl ?? 0) + (finalTotalPnl ?? 0),
                positionsCount,
                avgPositionSize,
                todayRealizedPnlHistorical: m4,
                todayTradingPnlIntraday: m5_1,
                todayTradingPnlIntradayM5_1: m5_1,
                todayTradingPnlIntradayM5_2: m5_2,
                todayTradeCount: todayTotal,
                todayTradeCounts: {
                    buy: todayBuy,
                    sell: todaySell,
                    short: todayShort,
                    cover: todayCover,
                    total: todayTotal
                },
                totalTradeCount: totalTotal,
                totalTradeCounts: {
                    buy: totalBuy,
                    sell: totalSell,
                    short: totalShort,
                    cover: totalCover,
                    total: totalTotal
                },
                winRate,
                winRateStats: {
                    winCount,
                    lossCount,
                    winRate,
                    avgWin,
                    avgLoss,
                    pnlRatio,
                    expectancy
                },
                wtdWinRateStats,
                mtdWinRateStats,
                wtdTradeCounts,
                mtdTradeCounts,
                wtdPnl: m11,
                mtdPnl: m12,
                ytdPnl: m13,
                m4_historicalRealized: m4,
                m4_auditTrail: auditTrail ? auditTrail.filter(e => e.closeDate === todayNy && e.openDate !== todayNy) : [],
                m5_auditTrail: auditTrail ? auditTrail.filter(e => e.closeDate === todayNy && e.openDate === todayNy) : [],
                m5_1_breakdown: m5_1_breakdown_map ? Array.from(m5_1_breakdown_map.entries()).map(([sym, val]) => ({
                    symbol: sym,
                    realized: val.realized,
                    unrealized: val.unrealized,
                    total: val.realized + val.unrealized
                })).sort((a, b) => (a.total - b.total)) : [],
                m5_1_auditTrail: m5_1_events,
                m5_2_breakdown: (() => {
                    // Calculate M5.2 Breakdown (Ledger View)
                    const breakdownMap = new Map<string, { realized: number; unrealized: number }>();

                    // 1. Realized (Audit Trail: Open Today & Close Today)
                    if (auditTrail) {
                        auditTrail.forEach(e => {
                            if (e.closeDate === todayNy && e.openDate === todayNy) {
                                const item = breakdownMap.get(e.symbol) || { realized: 0, unrealized: 0 };
                                item.realized += e.pnl;
                                breakdownMap.set(e.symbol, item);
                            }
                        });
                    }

                    // 2. Unrealized (Global Open Positions: Opened Today)
                    if (openPositions && priceSnapshot) {
                        openPositions.forEach((queue, contractKey) => {
                            // contractKey is usually just symbol, or 'SYMBOL'
                            const symbol = normalizeSymbolForClient(contractKey.split(' ')[0]);
                            const priceRec = priceSnapshot.get(symbol);

                            if (priceRec && typeof priceRec.price === 'number') {
                                const currentPrice = priceRec.price;
                                queue.forEach(pos => {
                                    // Only consider positions established TODAY for M5.2 Unrealized
                                    if (pos.date === todayNy) {
                                        let pnl = 0;
                                        if (pos.qty > 0) { // Long
                                            pnl = (currentPrice - pos.cost) * pos.qty * pos.multiplier;
                                        } else { // Short
                                            pnl = (pos.cost - currentPrice) * Math.abs(pos.qty) * pos.multiplier;
                                        }

                                        const item = breakdownMap.get(symbol) || { realized: 0, unrealized: 0 };
                                        item.unrealized += pnl;
                                        breakdownMap.set(symbol, item);
                                    }
                                });
                            }
                        });
                    }

                    return Array.from(breakdownMap.entries()).map(([sym, val]) => ({
                        symbol: sym,
                        realized: val.realized,
                        unrealized: val.unrealized,
                        total: val.realized + val.unrealized
                    })).sort((a, b) => (a.total - b.total));
                })(),
                m5_1_trading: m5_1,
                m5_2_ledger: m5_2,
                m6_1_legacy: m6_1,
                m6_2_new: m6_2,
                m6_total: m6_total,
                m6_pnl_breakdown: (() => {
                    // Calculate M6 PnL breakdown per symbol using consistent Day Attribution (M6) logic
                    // This ensures Realized PnL matches Day Realized (vs Prev Close), not Historical (vs Cost).

                    const breakdown: { symbol: string; realized: number; unrealized: number; total: number }[] = [];

                    for (const [sym, res] of Object.entries(m6Results)) {
                        const realized = res.m6_1_realized + res.m6_2_realized;

                        let unrealized = 0;
                        const priceRec = getPriceRecord(normalizeSymbolForClient(sym));
                        const currentPrice = (priceRec && typeof priceRec.price === 'number') ? priceRec.price : null;

                        if (currentPrice !== null) {
                            // Legacy Unrealized: RemQty * (Curr - PrevClose)
                            if (res.remainingLegacyQty !== 0 && res.status === 'ok') {
                                const prevClose = robustRefMap[normalizeSymbolForClient(sym)]?.close ?? 0;
                                unrealized += res.remainingLegacyQty * (currentPrice - prevClose) * res.multiplier;
                            }

                            // New Unrealized: RemQty * (Curr - Entry)
                            for (const batch of res.remainingNewBatches) {
                                unrealized += batch.qty * (currentPrice - batch.price) * res.multiplier;
                            }
                        }

                        if (Math.abs(realized) > 0.01 || Math.abs(unrealized) > 0.01) {
                            breakdown.push({
                                symbol: sym,
                                realized,
                                unrealized,
                                total: realized + unrealized
                            });
                        }
                    }

                    return breakdown.sort((a, b) => b.total - a.total);
                })(),
                m5_2_auditTrail: m5_2_events,

                totalHistoricalRealizedPnl: m9_totalRealized,
            };

            return { rows, summary: finalSummary, historicalPnl, dailyPnlList, dailyPnlResults, pnlEvents: auditTrail };
        },
        [
            baseHoldings,
            dailyTxAggregates,
            refEodMap,
            todayEodMap,
            wtdBaseEodMap,
            mtdBaseEodMap,
            ytdBaseEodMap,
            transactions,
            getPriceRecord,
            mtdEodMap, // Add dependency
            memoizedM14BaseResults, // [NEW] Dependency on isolated M14
            priceSnapshot, // [FIX] Ensure re-calc on real-time price updates
            effectiveTodayNy, // [NEW] Added dependency
        ],
    );

    const loading = txLoading || eodLoading;

    const value = useMemo(() => ({
        rows,
        summary,
        historicalPnl,
        dailyPnlList,
        dailyPnlResults,
        pnlEvents,
        fullEodMap,
        loading,
        transactions: transactions || [], // [REVERT] Return full history, let components filter
        isCalculating: loading,
        refreshData: () => setRefreshVersion(v => v + 1),
        analysisYear,
        setAnalysisYear
    }), [rows, summary, historicalPnl, dailyPnlList, dailyPnlResults, pnlEvents, fullEodMap, loading, transactions, analysisYear]);

    return (
        <HoldingsContext.Provider value={value}>
            {children}
        </HoldingsContext.Provider>
    );
}

export function useHoldingsContext() {
    const context = useContext(HoldingsContext);
    if (!context) {
        throw new Error('useHoldingsContext must be used within a HoldingsProvider');
    }
    return context;
}
