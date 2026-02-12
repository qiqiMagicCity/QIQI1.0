'use client';

import React, { createContext, useContext, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useUser } from '@/firebase';
import { useFirestore } from '@/firebase/index';
// [FIX] Update imports
import { doc, getDoc, updateDoc, setDoc, onSnapshot, collection, query, orderBy, limit, getDocs, writeBatch, deleteField } from 'firebase/firestore';
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
    getLastTradingDayOfYear,
} from '@/lib/ny-time';
import {
    getOfficialCloses,
    getOfficialClosesRange,
    type OfficialCloseResult,
    getOfficialClosesBatch,
    triggerManualBackfill,
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
import { getActiveSymbols } from '@/lib/holdings/active-symbols';
import { useCorporateActions } from '@/hooks/use-corporate-actions';
import { FifoSnapshot } from '@/lib/types/fifo-snapshot'; // [NEW]

// [HELPER] Throttle high-frequency updates (e.g., real-time prices)
function useThrottledValue<T>(value: T, limit: number): T {
    const [throttledValue, setThrottledValue] = useState<T>(value);
    const lastRan = useRef<number>(Date.now());

    useEffect(() => {
        const handler = setTimeout(() => {
            if (Date.now() - lastRan.current >= limit) {
                setThrottledValue(value);
                lastRan.current = Date.now();
            }
        }, limit - (Date.now() - lastRan.current));

        return () => clearTimeout(handler);
    }, [value, limit]);

    return throttledValue;
}

// 鈥斺€?鏃ュ唴鐩堜簭鐘舵€佹灇涓?
export type DayPlStatus =
    | 'live'
    | 'closed'
    | 'session-pre'
    | 'session-post'
    | 'missing-ref-eod'
    | 'missing-today-eod'
    | 'pending-eod-fetch'
    | 'stale-last'
    | 'eod-fallback'
    | 'degraded';

export type AggTodayStatus =
    | 'live'
    | 'closed'
    | 'session-pre'
    | 'session-post'
    | 'stale-last'
    | 'pending-eod-fetch'
    | 'degraded';

type RtStatus = 'live' | 'stale' | 'closed' | 'pending' | 'error';
const FRESHNESS_MS = 60_000; // 1分钟

const AUTO_HEAL_CONFIG = {
    ENABLED: true, // Default enabled
    MAX_SYMBOLS_PER_TASK: 10,
    MAX_DAYS_PER_SYMBOL: 22,
    SESSION_LIMIT: 50, // Max requests per user session
    RETRY_DELAY_MS: 5 * 60 * 1000, // 5 Minutes
};

const normalizeSymbolForClient = (s: string): string =>
    (s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

const normalizeSymbolClient = normalizeSymbolForClient;

function rekeyEodMap(
    sourceMap: Record<string, OfficialCloseResult>,
    dateStr: string
): Record<string, OfficialCloseResult> {
    const out: Record<string, OfficialCloseResult> = {};
    for (const [sym, res] of Object.entries(sourceMap)) {
        const normSym = normalizeSymbolForClient(sym);
        const key = `${dateStr}_${normSym}`;
        out[key] = res;
    }
    return out;
}

function safeMergeEodMaps(
    lowerPriorityMap: Record<string, OfficialCloseResult>,
    higherPriorityMap: Record<string, OfficialCloseResult>
): Record<string, OfficialCloseResult> {
    const result = { ...lowerPriorityMap };
    for (const [key, highVal] of Object.entries(higherPriorityMap)) {
        const lowVal = result[key];
        const isHighValValid = highVal.status === 'ok' || highVal.status === 'plan_limited' || highVal.status === 'no_liquidity';
        const isLowValValid = lowVal?.status === 'ok' || lowVal?.status === 'plan_limited' || lowVal?.status === 'no_liquidity';

        if (isHighValValid) {
            result[key] = highVal;
            continue;
        }
        if (isLowValValid) {
            continue;
        }
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

function computeDayPnLSymbol(
    holding: { netQty: number; multiplier: number },
    marketSession: 'pre-market' | 'open' | 'post-market' | 'closed',
    isTradingDay: boolean,
    lastPriceData: { price: number | null; ts: number } | undefined,
    refEod: OfficialCloseResult | undefined,
    todayEod: OfficialCloseResult | undefined,
    todaysTrades: Tx[],
    refEodDate?: string,
    manualPriceOverride?: number,
): {
    todayPl: number | null;
    todayPlStatus: DayPlStatus;
    refPrice: number | null;
    prevClose: number | null;
    refDateUsed?: string;
    dayChange: number | null;
    dayChangePct: number | null;
} {
    const isRefValid = refEod?.status === 'ok' || refEod?.status === 'plan_limited' || refEod?.status === 'no_liquidity';
    const prevClose = isRefValid && refEod?.close != null ? refEod.close : undefined;

    if (prevClose === undefined) {
        if (refEod?.status === 'pending') {
            return {
                todayPl: null,
                todayPlStatus: 'pending-eod-fetch',
                refPrice: null,
                prevClose: null,
                refDateUsed: refEodDate,
                dayChange: null,
                dayChangePct: null,
            };
        }
        return {
            todayPl: null,
            todayPlStatus: 'missing-ref-eod',
            refPrice: null,
            prevClose: null,
            refDateUsed: refEodDate,
            dayChange: null,
            dayChangePct: null,
        };
    }

    let refPrice: number | undefined;
    let status: DayPlStatus = 'live';

    if (manualPriceOverride != null && Number.isFinite(manualPriceOverride)) {
        refPrice = manualPriceOverride;
        status = 'live';
    }
    else if (lastPriceData?.price != null) {
        const isStale = Date.now() - lastPriceData.ts > FRESHNESS_MS;
        refPrice = lastPriceData.price;
        status = isStale ? 'stale-last' : 'live';
    }
    else if ((todayEod?.status === 'ok' || todayEod?.status === 'plan_limited' || todayEod?.status === 'no_liquidity') && todayEod?.close != null) {
        refPrice = todayEod.close;
        status = 'closed';
    }
    // [EOD FALLBACK] If no current price but we have yesterday's close (prevClose)
    else if (prevClose != null) {
        refPrice = prevClose;
        status = 'eod-fallback';
    }
    else {
        if (todayEod?.status === 'pending' || refEod?.status === 'pending') {
            return {
                todayPl: null,
                todayPlStatus: 'pending-eod-fetch',
                refPrice: null,
                prevClose,
                refDateUsed: refEodDate,
                dayChange: null,
                dayChangePct: null,
            };
        }
        return {
            todayPl: null,
            todayPlStatus: 'degraded',
            refPrice: null,
            prevClose,
            refDateUsed: refEodDate,
            dayChange: null,
            dayChangePct: null,
        };
    }

    if (refPrice == null || !Number.isFinite(refPrice)) {
        return {
            todayPl: null,
            todayPlStatus: status,
            refPrice: null,
            prevClose,
            dayChange: null,
            dayChangePct: null,
        };
    }

    const { netQty, multiplier } = holding;
    const sumTradesEffect = todaysTrades.reduce((sum, tx) => {
        return sum + (tx.price - prevClose) * tx.qty;
    }, 0);

    const rawPnl = netQty * (refPrice - prevClose) - sumTradesEffect;
    const todayPl = Math.round(rawPnl * multiplier * 100) / 100;
    const dayChange = refPrice - prevClose;
    const dayChangePct = prevClose !== 0 ? dayChange / prevClose : 0;

    return {
        todayPl,
        todayPlStatus: status,
        refPrice,
        prevClose,
        refDateUsed: refEodDate,
        dayChange,
        dayChangePct,
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
    lots?: { qty: number; price: number; ts: number }[];
    lastUpdatedTs?: number;
    isHidden?: boolean;
    isEodFallback?: boolean;
    contractKey?: string; // [NEW] Added for stable key identification of options
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
    m5_auditTrail?: AuditEvent[];
    m5_1_breakdown?: { symbol: string; realized: number; unrealized: number; total: number }[];
    m5_1_auditTrail?: AuditEvent[];
    m5_2_breakdown?: { symbol: string; realized: number; unrealized: number; total: number }[];
    m5_2_auditTrail?: AuditEvent[];
    m5_1_trading: number | null;
    m5_2_ledger: number | null;
    m6_1_legacy: number | null;
    m6_2_new: number | null;
    m6_total: number | null;
    m6_pnl_breakdown?: { symbol: string; realized: number; unrealized: number; total: number }[];
    totalHistoricalRealizedPnl: number | null;
}

interface HoldingsContextValue {
    rows: HoldingRow[];
    summary: HoldingsSummary;
    historicalPnl: { symbol: string; pnl: number }[];
    dailyPnlList: { date: string; pnl: number }[];
    dailyPnlResults: Record<string, DailyPnlResult>;
    pnlEvents?: any[];
    auditTrail?: AuditEvent[]; // [NEW] Expose detailed ledger for Leaderboard
    historicalPnlMetrics?: { // [NEW] Diagnostic metrics for leaderboard reliability
        totalSymbols: number;
        invalidPnlCount: number;
        aggregatedCount: number;
    };
    loading: boolean;
    isCalculating: boolean;
    transactions: Tx[];
    fullEodMap: Record<string, OfficialCloseResult>;
    ytdBaseEodMap: Record<string, OfficialCloseResult>;
    activeSplits: any;
    effectiveUid: string | null;
    refreshData: () => void;
    availableYears: number[];
    analysisYear: number;
    setAnalysisYear: (y: number) => void;
    showHidden: boolean;
    setShowHidden: (show: boolean) => void;
    toggleHidden: (symbol: string) => void;
    allTransactions: Tx[];
    isAutoHealing: boolean; // [NEW]
    autoHealProgress?: { total: number; current: number; status: string } | null; // [NEW]
    isLiveMode: boolean; // [NEW]
}

const HoldingsContext = createContext<HoldingsContextValue | null>(null);

export function HoldingsProvider({ children }: { children: React.ReactNode }) {
    const { user, impersonatedUid } = useUser();
    const effectiveUid = impersonatedUid || user?.uid || null;
    const firestore = useFirestore();

    const { data: allTransactions, loading: txLoading } = useUserTransactions(effectiveUid);

    // [NEW] Snapshot State
    const [latestSnapshot, setLatestSnapshot] = useState<FifoSnapshot | null>(null);

    // [NEW] Live Mode detection
    const [isLiveMode, setIsLiveMode] = useState(false);

    // [NEW] Auto-Heal Session Guardrails
    const [sessionRequestCount, setSessionRequestCount] = useState(0);
    const [isEcoMode, setIsEcoMode] = useState(false);
    const knownSymbolsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const forceLive = new URLSearchParams(window.location.search).get('live') === '1';
            setIsLiveMode(forceLive);
            if (forceLive) {
                console.warn('[LIVE-MODE] enabled: skipping Snapshot.hydrate');
            }

            // [E1] Startup log for Auto-Heal config
            console.log('[AutoHeal] Config Initialized:', AUTO_HEAL_CONFIG);
        }
    }, []);

    useEffect(() => {
        if (!effectiveUid) return;
        if (isLiveMode) return; // Skip hydration in Live Mode
        const fetchSnapshot = async () => {
            try {
                // [FIX] Do not call hooks inside useEffect
                const snapsRef = collection(firestore, 'users', effectiveUid, 'snapshots');
                const q = query(snapsRef, orderBy('date', 'desc'), limit(1));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    const snap = querySnapshot.docs[0].data() as FifoSnapshot;
                    if (snap && snap.inventory) {
                        // DEBUG:EOD-TIMELINE-AUDIT
                        import('@/lib/debug/eod-timeline').then(({ audit }) => {
                            audit("Snapshot.hydrate", {
                                snapshotDate: snap.date,
                                inventoryCount: snap.inventory.length,
                                source: "remoteSnapshot"
                            });
                        });
                        console.log(`[HoldingsProvider] 鈿★笍 Hydrated from Snapshot: ${snap.date}`);
                        setLatestSnapshot(snap);
                    }
                }
            } catch (e) {
                console.warn("[HoldingsProvider] Failed to fetch snapshots:", e);
            }
        };
        fetchSnapshot();
    }, [effectiveUid, isLiveMode]);

    const availableYears = useMemo(() => {
        if (!allTransactions || allTransactions.length === 0) return [new Date().getFullYear()];

        const currentYear = new Date().getFullYear();
        const yearsSet = new Set<number>([currentYear]);

        for (let i = 0; i < allTransactions.length; i++) {
            const tx = allTransactions[i];
            const ts = tx.transactionTimestamp;
            // Faster year extraction than new Date()
            const y = new Date(ts).getFullYear();
            if (y > 1900 && y <= currentYear + 1) {
                yearsSet.add(y);
            }
        }
        return Array.from(yearsSet).sort((a, b) => b - a);
    }, [allTransactions]);

    const [refreshVersion, setRefreshVersion] = useState(0);
    const [analysisYear, setAnalysisYear] = useState<number>(new Date().getFullYear());
    const [showHidden, setShowHidden] = useState(false);
    const [hiddenFlags, setHiddenFlags] = useState<Record<string, boolean>>({});
    // const firestore = useFirestore(); // Moved to top
    const [manualMarkPrices, setManualMarkPrices] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!effectiveUid) {
            setHiddenFlags({});
            setManualMarkPrices({});
            return;
        }
        const holdingsRef = collection(firestore, 'users', effectiveUid, 'holdings');
        const unsubscribe = onSnapshot(holdingsRef, (snapshot) => {
            const flags: Record<string, boolean> = {};
            const marks: Record<string, number> = {};
            snapshot.forEach((doc) => {
                const data = doc.data();
                const sym = normalizeSymbolClient(doc.data().symbol || doc.id);
                if (data.isHidden) flags[sym] = true;
                if (typeof data.manualMarkPrice === 'number') {
                    // [AUTO-FIX] NVO ghost price removal
                    if ((Math.abs(data.manualMarkPrice - 15) < 0.01) && sym.includes('NVO')) {
                        console.log(`[HoldingsProvider] ?? Auto-deleting stuck manual price (15.00) for ${sym}`);
                        updateDoc(doc.ref, { manualMarkPrice: deleteField() }).catch(e => console.error(e));
                    } else {
                        marks[sym] = data.manualMarkPrice;
                    }
                }
            });
            setHiddenFlags(flags);
            setManualMarkPrices(marks);
        }, (err) => console.error("Failed to subscribe:", err));
        return () => unsubscribe();
    }, [effectiveUid, firestore]);

    const toggleHidden = useCallback(async (symbol: string) => {
        if (!user || !effectiveUid || !symbol) return;
        try {
            const holdingDocRef = doc(firestore, 'users', effectiveUid, 'holdings', symbol.toUpperCase());
            const snap = await getDoc(holdingDocRef);
            if (snap.exists()) {
                await updateDoc(holdingDocRef, { isHidden: !snap.data().isHidden });
            } else {
                await setDoc(holdingDocRef, { isHidden: true }, { merge: true });
            }
        } catch (err) { console.error("Failed to toggle hidden:", err); }
    }, [user, effectiveUid, firestore]);

    const effectiveTodayNy = useMemo(() => {
        const currentYear = new Date().getFullYear();
        if (analysisYear > 0 && analysisYear < currentYear) {
            return getLastTradingDayOfYear(analysisYear);
        }
        return getEffectiveTradingDay();
    }, [analysisYear]);

    const transactions = useMemo(() => {
        if (!allTransactions) return [];
        if (!analysisYear) return allTransactions;
        return allTransactions.filter(tx => {
            return toNyCalendarDayString(tx.transactionTimestamp) <= effectiveTodayNy;
        });
    }, [allTransactions, effectiveTodayNy, analysisYear]);

    const visibleTransactions = useMemo(() => {
        if (!transactions) return [];
        return transactions.filter(tx => !hiddenFlags[normalizeSymbolClient(tx.symbol)]);
    }, [transactions, hiddenFlags]);

    const baseHoldings = useMemo(() => {
        const list = Array.isArray(transactions) ? (transactions as Tx[]) : [];
        if (list.length === 0) return [];
        const snap = buildHoldingsSnapshot(list);
        const rawHoldings = snap.holdings ?? [];
        return rawHoldings.map(h => ({
            ...h,
            isHidden: hiddenFlags[h.symbol] === true
        }));
    }, [transactions, hiddenFlags]);

    const dailyTxAggregates = useMemo(() => {
        const aggregates = new Map<string, { dayQtyDelta: number; dayNotional: number; trades: Tx[] }>();
        const baseDay = effectiveTodayNy;
        if (Array.isArray(transactions)) {
            for (const tx of transactions) {
                const ts = tx.transactionTimestamp;
                if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue;
                if (toNyCalendarDayString(ts) !== baseDay) continue;
                const symbol = normalizeSymbolClient(tx.symbol);
                let entry = aggregates.get(symbol);
                if (!entry) {
                    entry = { dayQtyDelta: 0, dayNotional: 0, trades: [] };
                    aggregates.set(symbol, entry);
                }
                entry.dayQtyDelta += tx.qty;
                entry.dayNotional += tx.price * tx.qty;
                entry.trades.push(tx);
            }
        }
        return aggregates;
    }, [transactions, effectiveTodayNy]);

    const uniqueSymbols = useMemo(() => {
        const symbols = new Set<string>();
        transactions.forEach(tx => symbols.add(normalizeSymbolClient(tx.symbol)));
        dailyTxAggregates.forEach((_, key) => symbols.add(key));
        return Array.from(symbols);
    }, [transactions, dailyTxAggregates]);

    const { get: getPriceRecord, snapshot: priceSnapshot } = useRealTimePrices(uniqueSymbols);
    const throttledPriceSnapshot = useThrottledValue(priceSnapshot, 200);

    const [refEodMap, setRefEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [todayEodMap, setTodayEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [wtdBaseEodMap, setWtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [mtdBaseEodMap, setMtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [ytdBaseEodMap, setYtdBaseEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [robustEodMap, setRobustEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [eodLoading, setEodLoading] = useState(false);

    // [NEW] Backfill Logic State
    const [lastBackfillTs, setLastBackfillTs] = useState(0);
    const [isAutoHealing, setIsAutoHealing] = useState(false);

    // [FIX] Track attempted Ref Price backfills to prevent infinite loops
    const attemptedRefFixesRef = useRef(new Set<string>());

    useEffect(() => {
        if (uniqueSymbols.length === 0) {
            setRefEodMap({}); setTodayEodMap({}); setEodLoading(false); return;
        }
        let cancelled = false;
        const fetchEod = async () => {
            setEodLoading(true);
            const baseDay = effectiveTodayNy;
            const refDay = prevNyTradingDayString(baseDay);
            const { wtd: wtdBase, mtd: mtdBase, ytd: ytdBase } = getPeriodBaseDates(baseDay);

            const { ytd: ytdStartStr } = getPeriodStartDates(baseDay);
            const robustRange = eachDayOfInterval({
                start: new Date(`${ytdStartStr}T12:00:00Z`),
                end: new Date(`${baseDay}T12:00:00Z`)
            }).map(d => toNyCalendarDayString(d));

            try {
                const symbolsNorm = uniqueSymbols.map(normalizeSymbolForClient);
                const [refCloses, todayCloses, wtdBaseCloses, mtdBaseCloses, ytdBaseCloses, robustResults] = await Promise.all([
                    getOfficialCloses(refDay, symbolsNorm),
                    getOfficialCloses(baseDay, symbolsNorm),
                    getOfficialCloses(wtdBase, symbolsNorm),
                    getOfficialCloses(mtdBase, symbolsNorm),
                    getOfficialCloses(ytdBase, symbolsNorm),
                    getOfficialClosesBatch(robustRange, symbolsNorm)
                ]);

                if (cancelled) return;
                setRefEodMap(refCloses);
                setTodayEodMap(todayCloses);
                setWtdBaseEodMap(wtdBaseCloses);
                setMtdBaseEodMap(mtdBaseCloses);
                setYtdBaseEodMap(ytdBaseCloses);
                setRobustEodMap(robustResults); // Now contains YTD robust data to support calendar
            } catch (error) { console.error('Fetch EOD failed', error); }
            finally { if (!cancelled) setEodLoading(false); }
        };
        fetchEod();
        return () => { cancelled = true; };
    }, [uniqueSymbols, effectiveTodayNy, lastBackfillTs]); //Added lastBackfillTs

    // [NEW] Auto-Heal: Check for missing Ref Prices on active positions
    useEffect(() => {
        if (eodLoading || !baseHoldings.length) return;

        const refDay = prevNyTradingDayString(effectiveTodayNy);
        const missingSymbols: string[] = [];

        // Check only for missing Ref EOD (Critical for Day PnL)
        baseHoldings.forEach((h: any) => {
            const sym = normalizeSymbolClient(h.symbol);
            if (h.netQty !== 0 && !hiddenFlags[sym]) {
                const stat = refEodMap[sym]?.status;
                if (!stat || stat === 'missing' || stat === 'error') {
                    // [FIX] loop prevention
                    if (!attemptedRefFixesRef.current.has(sym)) {
                        missingSymbols.push(sym);
                    }
                }
            }
        });

        if (missingSymbols.length > 0) {
            console.warn(`[AutoHeal] Found ${missingSymbols.length} missing ref prices for ${refDay}. Attempting backfill...`, missingSymbols);

            // [FIX] Mark as attempted immediately
            missingSymbols.forEach(s => attemptedRefFixesRef.current.add(s));

            setIsAutoHealing(true);
            const candidates = missingSymbols.slice(0, 5); // Limit batch size for direct execution

            triggerManualBackfill(refDay, candidates, true)
                .then(() => {
                    console.log("[AutoHeal] Backfill complete. Refreshing data...");
                    // Force re-fetch of EOD data to update UI
                    setLastBackfillTs(Date.now());
                })
                .catch(err => console.warn("[AutoHeal] Failed:", err))
                .finally(() => setIsAutoHealing(false));
        }
    }, [eodLoading, baseHoldings, refEodMap, effectiveTodayNy, hiddenFlags]);

    const { splits: activeSplits } = useCorporateActions();

    const fullEodMap = useMemo(() => {
        const todayNy = effectiveTodayNy;
        const refDateUsed = prevNyTradingDayString(todayNy);
        const periodBaseDates = getPeriodBaseDates(todayNy);
        let combinedEod = { ...robustEodMap };
        const specificMaps = [
            rekeyEodMap(ytdBaseEodMap, periodBaseDates.ytd),
            rekeyEodMap(mtdBaseEodMap, periodBaseDates.mtd),
            rekeyEodMap(wtdBaseEodMap, periodBaseDates.wtd),
            rekeyEodMap(refEodMap, refDateUsed),
            rekeyEodMap(todayEodMap, todayNy)
        ];
        for (const map of specificMaps) combinedEod = safeMergeEodMaps(combinedEod, map);
        if (manualMarkPrices && Object.keys(manualMarkPrices).length > 0) {
            const manualMap: Record<string, OfficialCloseResult> = {};
            for (const [sym, price] of Object.entries(manualMarkPrices)) {
                manualMap[sym] = { date: todayNy, symbol: sym, close: price, status: 'ok', source: 'manual' } as any;
            }
            combinedEod = safeMergeEodMaps(combinedEod, rekeyEodMap(manualMap, todayNy));
        }

        return combinedEod;
    }, [robustEodMap, ytdBaseEodMap, mtdBaseEodMap, wtdBaseEodMap, refEodMap, todayEodMap, effectiveTodayNy, manualMarkPrices]);

    const [memoizedM14BaseResults, setMemoizedM14BaseResults] = useState<Record<string, DailyPnlResult>>({});
    const [isM14Calculating, setIsM14Calculating] = useState(false);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        const worker = new Worker(new URL('../workers/pnl.worker.ts', import.meta.url));
        workerRef.current = worker;
        worker.onmessage = (event) => {
            const { results, error } = event.data;
            if (!error && results) setMemoizedM14BaseResults(results);
            setIsM14Calculating(false);
        };
        return () => worker.terminate();
    }, []);

    useEffect(() => {
        if (!workerRef.current) return;
        setIsM14Calculating(true);
        workerRef.current.postMessage({
            visibleTransactions,
            fullEodMap,
            activeSplits,
            effectiveTodayNy,
            snapshot: latestSnapshot, // [NEW] Pass snapshot to worker
            isEodLoading: eodLoading // [NEW] Pass loading state
        });
    }, [effectiveTodayNy, fullEodMap, visibleTransactions, activeSplits, latestSnapshot, eodLoading]);

    // [NEW] Global Auto-Heal for Historical Calendar Gaps (Moved here to access memoizedM14BaseResults)
    // Map<Key, Timestamp> to track attempts. Key = `${date}_${symbol}`
    const attemptedBackfillsRef = useRef(new Map<string, number>());
    // [NEW] Track progress: { total: number of days found initially, fixed: number of days fixed }
    const [autoHealProgress, setAutoHealProgress] = useState<{ total: number; current: number; status: string } | null>(null);

    // [NEW] Clear backfill history on manual refresh to allow retries
    useEffect(() => {
        if (attemptedBackfillsRef.current.size > 0 || attemptedRefFixesRef.current.size > 0) {
            console.log(`[AutoHeal] Manual refresh (v${refreshVersion}) detected. Clearing attempted backfills.`);
            attemptedBackfillsRef.current.clear();
            attemptedRefFixesRef.current.clear();
        }
    }, [refreshVersion]);

    useEffect(() => {
        if (!AUTO_HEAL_CONFIG.ENABLED) return;
        if (isEcoMode) return;
        if (eodLoading || isAutoHealing) return;

        // 1. Scan M14 Results for Gaps
        const missingTasks: { date: string; symbols: string[] }[] = [];
        const now = Date.now();
        const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 Minutes Retry TTL

        Object.values(memoizedM14BaseResults).forEach(res => {
            if (res.status === 'missing_data' && res.missingSymbols && res.missingSymbols.length > 0) {
                // Filter out recently attempted
                const freshSymbols = res.missingSymbols.filter(s => {
                    const key = `${res.date}_${s}`;
                    const lastAttempt = attemptedBackfillsRef.current.get(key);
                    if (lastAttempt && (now - lastAttempt < RETRY_DELAY_MS)) {
                        // [E5] Logging deduplication
                        if (!attemptedBackfillsRef.current.has(`${key}_logged`)) {
                            console.log(`[AutoHeal] DEDUPED: Skipping recently requested ${key}.`);
                            attemptedBackfillsRef.current.set(`${key}_logged`, now);
                        }
                        return false; // Recently attempted, skip
                    }
                    return true;
                });

                if (freshSymbols.length > 0) {
                    missingTasks.push({ date: res.date, symbols: freshSymbols });
                }
            }
        });

        if (missingTasks.length === 0) return;

        // [D2] New Symbol Detection & Prioritization
        const currentActiveSymbols = new Set(baseHoldings.map(h => normalizeSymbolClient(h.symbol)));
        const newSymbols = Array.from(currentActiveSymbols).filter(s => !knownSymbolsRef.current.has(s));

        if (newSymbols.length > 0) {
            console.log(`[AutoHeal] Detected ${newSymbols.length} NEW symbols: ${newSymbols.join(', ')}. Monitoring for gaps...`);
            newSymbols.forEach(s => knownSymbolsRef.current.add(s));
        }

        // 2. Pick the first task to execute (Sequential Fix)
        // [FIX - UX Upgrade] Instead of slicing 3, we send ALL symbols for the oldest date.
        // The backend 'requestBackfillEod' will handle queuing via PubSub if > 3.
        missingTasks.sort((a, b) => a.date.localeCompare(b.date));

        const task = missingTasks[0]; // Fix oldest date first (full batch)
        let batch = task.symbols;

        // [D3] Cost Hard Guardrails
        if (batch.length > AUTO_HEAL_CONFIG.MAX_SYMBOLS_PER_TASK) {
            console.warn(`[AutoHeal] CHUNKED: Batch size ${batch.length} exceeds limit. Requesting first ${AUTO_HEAL_CONFIG.MAX_SYMBOLS_PER_TASK}.`);
            batch = batch.slice(0, AUTO_HEAL_CONFIG.MAX_SYMBOLS_PER_TASK);
        }

        if (sessionRequestCount >= AUTO_HEAL_CONFIG.SESSION_LIMIT) {
            console.error(`[AutoHeal] SESSION_LIMIT (${AUTO_HEAL_CONFIG.SESSION_LIMIT}) reached. Enabling ECO_MODE.`);
            setIsEcoMode(true);
            return;
        }

        const trigger = batch.some(s => newSymbols.includes(s)) ? 'NEW_SYMBOL' : 'GAP_HEALING';
        console.info(`[AutoHeal] AUTO_HEAL_ENQUEUED: symbolCount=${batch.length}, date=${task.date}, symbols=[${batch.join(', ')}], trigger=${trigger}`);

        // Mark as attempted immediately with timestamp to prevent re-triggering while queued
        batch.forEach(s => {
            attemptedBackfillsRef.current.set(`${task.date}_${s}`, Date.now());
        });

        setIsAutoHealing(true);
        // Update Progress - Show "Queueing" state
        setAutoHealProgress(prev => ({
            total: missingTasks.length + (prev?.current || 0),
            current: (prev?.current || 0) + 1,
            status: `请求同步 ${task.date} (${batch.length} 个标的)...`
        }));

        console.log(`[AutoHeal-Calendar] Triggering FULL backfill for ${task.date} [${batch.length} syms]`);

        triggerManualBackfill(task.date, batch, true)
            .then((res: any) => {
                // Determine if it was Direct or Queued
                const isQueued = res?.data?.queuedCount > 0;

                if (isQueued) {
                    console.info(`[AutoHeal-Loop] ${task.date}: QUEUED. Scheduling background refresh in 20s...`);
                    // [D1] Perception Loop: Queue mode triggers a delayed refresh to pick up background worker results
                    setTimeout(() => {
                        console.info(`[AutoHeal-Loop] ${task.date}: TRIGGERING BACKGROUND REFRESH (lastBackfillTs++)`);
                        setLastBackfillTs(Date.now());
                    }, 20000); // 20s satisfies the <=30s requirement
                } else {
                    console.log(`[AutoHeal-Loop] ${task.date}: DIRECT. Refreshing immediately.`);
                    setLastBackfillTs(Date.now());
                }

                setSessionRequestCount(prev => prev + batch.length);

                // Show long-running toast if queued
                if (isQueued) {
                    // We need a way to tell the user "It's working".
                    // Maybe update state to "Background Syncing..."
                }
            })
            .catch(e => {
                console.error("[AutoHeal-Calendar] Failed", e);
            })
            .finally(() => {
                // Release critical section lock immediately so we can process OTHER dates if needed?
                // Or wait? 
                // If we queue date 1, we want to queue date 2 immediately too?
                // "Sequential" might be too slow if we have 100 days missing.
                // Let's release lock immediately. The 'attemptedBackfillsRef' prevents re-queueing same day.
                setIsAutoHealing(false);
            });
    }, [memoizedM14BaseResults, eodLoading, isAutoHealing, refreshVersion]);

    // Clear progress if clean
    useEffect(() => {
        if (!isAutoHealing && autoHealProgress) {
            // Check if really done? We need to wait for next M14 calculation. 
            // Logic: If M14 results come back clean, we clear progress.
            const hasGaps = Object.values(memoizedM14BaseResults).some(r => r.status === 'missing_data' && r.missingSymbols?.length);
            if (!hasGaps && !eodLoading) {
                const t = setTimeout(() => setAutoHealProgress(null), 2000); // Hide after delay
                return () => clearTimeout(t);
            }
        }
    }, [memoizedM14BaseResults, isAutoHealing, eodLoading, autoHealProgress]);

    const globalFifoResult = useMemo(() => {
        return calcGlobalFifo({
            transactions: visibleTransactions || [],
            todayNy: effectiveTodayNy,
            snapshot: latestSnapshot
        });
    }, [visibleTransactions, effectiveTodayNy, latestSnapshot]);

    // [OPTIMIZATION] Step 1: Base Holdings Calculation (Independent of Prices)
    const baseHoldingsResult = useMemo(() => {
        const snapshotResult = buildHoldingsSnapshot(visibleTransactions || [], effectiveTodayNy, activeSplits);
        const holdings = snapshotResult.holdings;

        // Pre-index holdings by normalized symbol for O(1) lookup
        const holdingMap = new Map<string, any>();
        holdings.forEach(h => {
            const sym = normalizeSymbolClient(h.symbol);
            if (!holdingMap.has(sym)) {
                holdingMap.set(sym, h);
            } else {
                // Merge if multiple holdings exist (rare but possible due to contract keys)
                const existing = holdingMap.get(sym);
                existing.netQty += h.netQty;
                existing.realizedPnl += (h.realizedPnl || 0);
                existing.costBasis += (h.costBasis || 0);
                if (h.lots) existing.lots = (existing.lots || []).concat(h.lots);
            }
        });

        return { holdings, holdingMap, snapshotResult };
    }, [visibleTransactions, effectiveTodayNy, activeSplits]);

    // [OPTIMIZATION] Step 2: Structural Data (Metrics that don't need real-time prices)
    const structuralData = useMemo(() => {
        const { m4, m5_2, pnlEvents, auditTrail, totalRealizedPnl: globalRealized } = globalFifoResult;
        const { wtd: wtdStart, mtd: mtdStart, ytd: ytdStart } = getPeriodStartDates(effectiveTodayNy);

        const wtdPnlValue = calcM11_Wtd(memoizedM14BaseResults, wtdStart, effectiveTodayNy);
        const mtdPnlValue = calcM12_Mtd(memoizedM14BaseResults, mtdStart, effectiveTodayNy);
        const ytdPnlValue = calcM13_Ytd(memoizedM14BaseResults, ytdStart, effectiveTodayNy);

        const calcWinRateStats = (startDate: string) => {
            const events = (pnlEvents || []).filter(e => e.date >= startDate);
            let wins = 0; let losses = 0;
            events.forEach(e => { if (e.pnl > 0.001) wins++; else if (e.pnl < -0.001) losses++; });
            const total = wins + losses;
            const winRate = total > 0 ? wins / total : 0;
            return { winCount: wins, lossCount: losses, winRate };
        };

        const wtdWinRateStats = calcWinRateStats(wtdStart);
        const mtdWinRateStats = calcWinRateStats(mtdStart);

        const dailyPnlListValue = Object.values(memoizedM14BaseResults)
            .map(r => ({ date: r.date, pnl: r.totalPnl }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Period-specific transaction filters
        const wtdTxs = (visibleTransactions || []).filter(tx => toNyCalendarDayString(tx.transactionTimestamp) >= wtdStart);
        const mtdTxs = (visibleTransactions || []).filter(tx => toNyCalendarDayString(tx.transactionTimestamp) >= mtdStart);

        const calcTradeCounts = (txs: Tx[]) => {
            const counts = { buy: 0, sell: 0, short: 0, cover: 0, total: 0 };
            txs.forEach(tx => {
                const type = tx.type ? tx.type.toLowerCase() : '';
                if (type === 'buy') counts.buy++;
                else if (type === 'sell') counts.sell++;
                else if (type === 'short') counts.short++;
                else if (type === 'cover') counts.cover++;
            });
            counts.total = counts.buy + counts.sell + counts.short + counts.cover;
            return counts;
        };

        return {
            globalRealized, m4, m5_2, pnlEvents, auditTrail,
            wtdPnlValue, mtdPnlValue, ytdPnlValue,
            wtdWinRateStats, mtdWinRateStats,
            dailyPnlListValue,
            wtdTxs, mtdTxs,
            calcTradeCounts,
            periods: { wtdStart, mtdStart, ytdStart }
        };
    }, [globalFifoResult, memoizedM14BaseResults, effectiveTodayNy, visibleTransactions]);

    const { rows, summary, historicalPnl, dailyPnlList, dailyPnlResults, pnlEvents: contextPnlEvents } = useMemo(() => {
        const { holdingMap } = baseHoldingsResult;
        const {
            globalRealized, m4, m5_2, pnlEvents, auditTrail,
            wtdPnlValue, mtdPnlValue, ytdPnlValue,
            wtdWinRateStats, mtdWinRateStats,
            dailyPnlListValue,
            wtdTxs, mtdTxs,
            calcTradeCounts,
            periods
        } = structuralData;

        let totalMv = 0; let totalPnl = 0; let totalTodayPl = 0; let totalGrossMv = 0;
        let totalNci = 0; let positionsCount = 0; let totalRealizedPnl = 0;

        const now = new Date();
        const currentRealTimeNy = toNyCalendarDayString(now);
        const isHistoricalView = effectiveTodayNy < currentRealTimeNy;
        const marketSession = isHistoricalView ? 'closed' : getNyMarketSessionLocal(now);
        const isTradingDay = !isHistoricalView && (!US_MARKET_HOLIDAYS.has(currentRealTimeNy) && nyWeekdayIndex(now) > 0 && nyWeekdayIndex(now) < 6);

        // Collect all unique symbols once
        const allSymbolsSet = new Set<string>(holdingMap.keys());
        dailyTxAggregates.forEach((_, key) => allSymbolsSet.add(key));

        const allGeneratedRows: HoldingRow[] = Array.from(allSymbolsSet).map((symbolKey): HoldingRow => {
            const h = holdingMap.get(symbolKey);
            const multiplier = h ? (h.multiplier ?? 1) : 1;
            const netQty = h ? h.netQty : 0;
            const avgCost = h && h.netQty !== 0 ? h.costBasis / (h.netQty * multiplier) : 0;

            const priceRecord = throttledPriceSnapshot.get(symbolKey);
            const daily = dailyTxAggregates.get(symbolKey);

            // [UNIFIED] Compute Day P/L and effective price using same logic
            // If historical view, we ignore real-time price snapshot
            const rtPriceData = isHistoricalView ? { price: null, ts: 0 } : { price: priceRecord?.price || null, ts: priceRecord?.ts || 0 };

            const dayRes = computeDayPnLSymbol(
                { netQty, multiplier },
                marketSession,
                isTradingDay,
                rtPriceData,
                refEodMap[symbolKey],
                todayEodMap[symbolKey],
                daily?.trades || [],
                undefined,
                manualMarkPrices[symbolKey]
            );

            let last: number | null = dayRes.refPrice;
            const isEodFallback = dayRes.todayPlStatus === 'eod-fallback';

            const mv = last !== null ? netQty * multiplier * last : null;
            const pnl = (mv !== null && h) ? mv - h.costBasis : null;
            const realizedPnl = (h?.realizedPnl || 0);

            let breakEvenPrice = null;
            if (h && netQty !== 0) {
                breakEvenPrice = (h.costBasis - realizedPnl) / (netQty * multiplier);
            }

            return {
                symbol: symbolKey, assetType: h?.assetType || 'stock', netQty, avgCost,
                breakEvenPrice, multiplier, last, mv, pnl, pnlPct: pnl && h && h.costBasis ? pnl / Math.abs(h.costBasis) : 0,
                todayPl: dayRes.todayPl, todayPlStatus: dayRes.todayPlStatus,
                dayQtyDelta: daily?.dayQtyDelta || 0,
                dayNotional: daily?.dayNotional || 0,
                todayPlPct: 0, dayChange: dayRes.dayChange, dayChangePct: dayRes.dayChangePct,
                totalLifetimePnL: realizedPnl + (pnl || 0),
                realizedPnl,
                isHidden: hiddenFlags[symbolKey],
                lots: h?.lots || [],
                prevClose: dayRes.prevClose,
                refDateUsed: dayRes.refDateUsed,
                refPrice: dayRes.refPrice,
                priceStatus: (priceRecord?.status || 'closed') as any,
                isEodFallback,
                contractKey: h?.contractKey
            };
        }).filter(r => r.netQty !== 0 || (r.todayPl && Math.abs(r.todayPl) > 0.01) || r.isHidden);

        const visibleRows = allGeneratedRows.filter(r => !r.isHidden);

        visibleRows.forEach(r => {
            const mv = r.mv || 0;
            const pnl = r.pnl || 0;
            const cost = mv - pnl;

            if (r.mv) totalMv += r.mv;
            totalGrossMv += Math.abs(mv);
            totalNci += cost;

            if (r.pnl) totalPnl += r.pnl;
            if (r.todayPl) totalTodayPl += r.todayPl;
            totalRealizedPnl += (r.realizedPnl || 0);
            if (r.netQty !== 0) positionsCount++;
        });

        // Today's Trades
        const todayTxs: Tx[] = [];
        dailyTxAggregates.forEach(agg => todayTxs.push(...agg.trades));
        const todayTradeCounts = calcTradeCounts(todayTxs);

        const m5_1_result = calcM5_1_Trading({
            transactions: visibleTransactions || [],
            todayNy: effectiveTodayNy,
            currentPrices: throttledPriceSnapshot || new Map()
        });

        const m5_1_breakdown_array = Array.from(m5_1_result.breakdown.entries()).map(([sym, val]) => ({
            symbol: sym, realized: val.realized, unrealized: val.unrealized, total: val.realized + val.unrealized
        }));

        let m5_2_unrealized = 0;
        const m5_2_breakdown_map = new Map<string, { realized: number, unrealized: number }>();

        globalFifoResult.auditTrail.forEach(e => {
            if (e.closeDate === effectiveTodayNy && e.openDate === effectiveTodayNy) {
                const item = m5_2_breakdown_map.get(e.symbol) || { realized: 0, unrealized: 0 };
                item.realized += e.pnl;
                m5_2_breakdown_map.set(e.symbol, item);
            }
        });

        const openLotsAuditEvents: any[] = [];
        if (globalFifoResult.openPositions && throttledPriceSnapshot) {
            globalFifoResult.openPositions.forEach((lots, symKey) => {
                const priceRecord = throttledPriceSnapshot.get(symKey);
                if (priceRecord && typeof priceRecord.price === 'number') {
                    const mark = priceRecord.price;
                    lots.forEach(lot => {
                        if (lot.date === effectiveTodayNy) {
                            const pnl = (mark - lot.cost) * lot.qty * lot.multiplier;
                            m5_2_unrealized += pnl;
                            const item = m5_2_breakdown_map.get(symKey) || { realized: 0, unrealized: 0 };
                            item.unrealized += pnl;
                            m5_2_breakdown_map.set(symKey, item);
                            openLotsAuditEvents.push({
                                symbol: symKey, openDate: lot.date, closeDate: effectiveTodayNy,
                                openPrice: lot.cost, closePrice: mark, qty: lot.qty, pnl,
                                multiplier: lot.multiplier, isUnrealized: true
                            });
                        }
                    });
                }
            });
        }

        const m5_2_total = m5_2 + m5_2_unrealized;
        const m5_2_breakdown_array = Array.from(m5_2_breakdown_map.entries()).map(([sym, val]) => ({
            symbol: sym, realized: val.realized, unrealized: val.unrealized, total: val.realized + val.unrealized
        }));

        const summaryResult: HoldingsSummary = {
            totalMv, totalPnl, totalRealizedPnl: globalRealized, totalUnrealizedPnl: totalPnl,
            totalLifetimePnl: globalRealized + totalPnl, positionsCount,
            winRate: null,
            winRateStats: {
                winCount: globalFifoResult.winCount,
                lossCount: globalFifoResult.lossCount,
                winRate: (globalFifoResult.winCount + globalFifoResult.lossCount) > 0 ? globalFifoResult.winCount / (globalFifoResult.winCount + globalFifoResult.lossCount) : 0,
                avgWin: 0, avgLoss: 0, pnlRatio: 0, expectancy: 0
            },
            avgPositionSize: positionsCount > 0 ? totalGrossMv / positionsCount : 0,
            totalTodayPl: (marketSession === 'post-market' || marketSession === 'closed') ? totalTodayPl : null,
            aggTodayPlStatus: (marketSession === 'open' ? 'live' : marketSession === 'pre-market' ? 'session-pre' : marketSession === 'post-market' ? 'session-post' : 'closed') as AggTodayStatus,
            totalGrossMv,
            totalNci,
            gmvStatus: 'live', nciStatus: 'live', pnlStatus: 'live',
            todayRealizedPnlHistorical: m4,
            todayTradingPnlIntraday: m5_1_result.m5_1,
            todayTradingPnlIntradayM5_1: m5_1_result.m5_1,
            todayTradingPnlIntradayM5_2: m5_2_total,
            m5_1_breakdown: m5_1_breakdown_array,
            m5_1_auditTrail: m5_1_result.auditTrail,
            m5_2_breakdown: m5_2_breakdown_array,
            m5_2_auditTrail: [
                ...globalFifoResult.auditTrail.filter(e => e.closeDate === effectiveTodayNy && e.openDate === effectiveTodayNy),
                ...openLotsAuditEvents
            ],
            m4_auditTrail: globalFifoResult.auditTrail.filter(e => e.closeDate === effectiveTodayNy && e.openDate < effectiveTodayNy),
            todayTradeCount: todayTradeCounts.total,
            todayTradeCounts,
            totalTradeCount: calcTradeCounts(visibleTransactions || []).total,
            totalTradeCounts: calcTradeCounts(visibleTransactions || []),
            wtdWinRateStats: wtdWinRateStats as any,
            mtdWinRateStats: mtdWinRateStats as any,
            wtdTradeCounts: calcTradeCounts(structuralData.wtdTxs),
            mtdTradeCounts: calcTradeCounts(structuralData.mtdTxs),
            wtdPnl: wtdPnlValue, mtdPnl: mtdPnlValue, ytdPnl: ytdPnlValue,
            m4_historicalRealized: m4,
            m5_1_trading: m5_1_result.m5_1,
            m5_2_ledger: m5_2_total,
            m6_1_legacy: totalTodayPl,
            m6_2_new: 0,
            m6_total: totalTodayPl,
            totalHistoricalRealizedPnl: globalRealized,
            m6_pnl_breakdown: visibleRows.map(r => ({
                symbol: r.symbol,
                realized: r.realizedPnl || 0,
                unrealized: r.pnl || 0,
                total: r.todayPl || 0
            })).filter(x => Math.abs(x.total) > 0.01)
        };

        // [FIX] C1: Aggregate Historical PnL from Audit Trail with Observability
        const historicalPnlMap = new Map<string, number>();
        let invalidPnlCount = 0;

        if (auditTrail) {
            auditTrail.forEach(e => {
                if (e.symbol) {
                    if (Number.isFinite(e.pnl)) {
                        const val = historicalPnlMap.get(e.symbol) || 0;
                        historicalPnlMap.set(e.symbol, val + e.pnl);
                    } else {
                        invalidPnlCount++;
                    }
                }
            });
        }

        if (invalidPnlCount > 0) {
            console.warn(`[HoldingsProvider] Found ${invalidPnlCount} invalid PnL entries in auditTrail.`);
        }

        const historicalPnlValue = Array.from(historicalPnlMap.entries()).map(([symbol, pnl]) => ({ symbol, pnl }));
        const historicalPnlMetrics = {
            totalSymbols: historicalPnlValue.length,
            invalidPnlCount,
            aggregatedCount: auditTrail ? auditTrail.length : 0
        };

        // [DEBUG] Jitter Instrumentation: Trace dependency changes
        if (typeof window !== 'undefined') {
            (window as any).__HOLDINGS_MEMO_COUNT__ = ((window as any).__HOLDINGS_MEMO_COUNT__ || 0) + 1;
            console.log(`[HoldingsMemo] Run #${(window as any).__HOLDINGS_MEMO_COUNT__} | Rows: ${visibleRows.length} | HistSymbols: ${historicalPnlValue.length} | Invalid: ${invalidPnlCount} | Reason: ${!baseHoldingsResult ? 'baseHoldingsResult缺失' : '依赖项变更'
                }`);
        }

        return {
            rows: showHidden ? allGeneratedRows : visibleRows,
            summary: summaryResult,
            historicalPnl: historicalPnlValue,
            dailyPnlList: dailyPnlListValue,
            dailyPnlResults: memoizedM14BaseResults,
            pnlEvents,
            auditTrail: structuralData.auditTrail,
            historicalPnlMetrics, // [NEW]
            isLiveMode // [NEW]
        };
    }, [baseHoldingsResult, structuralData, dailyTxAggregates, throttledPriceSnapshot, refEodMap, todayEodMap, memoizedM14BaseResults, showHidden, manualMarkPrices, hiddenFlags, visibleTransactions, effectiveTodayNy]);


    useEffect(() => {
        if (typeof window !== 'undefined') (window as any).__AUDIT_CTX__ = { transactions, allTransactions };
    }, [transactions, allTransactions]);

    // [NEW] Rebuild History & Snapshots
    const [isRebuilding, setIsRebuilding] = useState(false);

    const rebuildHistory = useCallback(async () => {
        if (!effectiveUid || !workerRef.current || !allTransactions) return; // Fix: workerRef

        if (eodLoading) {
            // DEBUG:EOD-TIMELINE-AUDIT
            import('@/lib/debug/eod-timeline').then(({ audit }) => {
                audit("Snapshot.skip", { reason: "eod_not_ready", source: "rebuildHistory" });
            });
            console.warn("[HoldingsProvider] Rebuild blocked: EOD data still loading.");
            return;
        }

        console.log("[HoldingsProvider] Starting History Rebuild (Auto-Healing)...");
        setIsRebuilding(true);

        try {
            // 1. Ask Worker to Generate Snapshots
            workerRef.current.postMessage({
                action: 'GENERATE_SNAPSHOTS',
                transactions: allTransactions,
                uid: effectiveUid
            });

            // 2. Wait for response (One-off listener)
            const handleWorkerResponse = async (event: MessageEvent) => {
                const { action, snapshots, error } = event.data;

                if (action === 'SNAPSHOTS_ERROR') {
                    console.error("[HoldingsProvider] Rebuild Failed:", error);
                    setIsRebuilding(false);
                    workerRef.current?.removeEventListener('message', handleWorkerResponse);
                }

                if (action === 'SNAPSHOTS_GENERATED') {
                    workerRef.current?.removeEventListener('message', handleWorkerResponse);

                    // 3. Save to Firestore
                    console.log(`[HoldingsProvider] Worker generated ${Object.keys(snapshots).length} snapshots. Saving to DB...`);

                    const batchSize = 100; // Firestore batch limit is 500, keep safe
                    const entries = Object.entries(snapshots);
                    let batch = writeBatch(firestore);
                    let count = 0;

                    for (const [dateKey, data] of entries) {
                        const docRef = doc(firestore, 'users', effectiveUid, 'snapshots', dateKey);
                        batch.set(docRef, data);
                        count++;

                        if (count % batchSize === 0) {
                            await batch.commit();
                            batch = writeBatch(firestore);
                        }
                    }
                    if (count % batchSize !== 0) await batch.commit();

                    console.log("[HoldingsProvider] Rebackfill Complete! Refreshing context...");

                    // 4. Verification Check: Fetch the latest one immediately
                    // Reuse the existing fetchSnapshot logic by triggering a re-run?
                    // Best to just manually re-call fetchSnapshot logic or force refresh.
                    // The 'latestSnapshot' effect depends on 'effectiveUid'.
                    // We can force it by momentarily clearing it or just re-running the query.

                    // Let's just manually re-fetch here to be fast.
                    try {
                        const snapsRef = collection(firestore, 'users', effectiveUid, 'snapshots');
                        const q = query(snapsRef, orderBy('date', 'desc'), limit(1));
                        const querySnapshot = await getDocs(q);
                        if (!querySnapshot.empty) {
                            const snap = querySnapshot.docs[0].data() as FifoSnapshot;
                            setLatestSnapshot(snap);
                        }
                    } catch (e) { console.warn("Refetch failed", e); }

                    setIsRebuilding(false);
                }
            };

            workerRef.current.addEventListener('message', handleWorkerResponse); // Fix: workerRef

        } catch (e) {
            console.error(e);
            setIsRebuilding(false);
        }
    }, [effectiveUid, allTransactions, firestore]);

    const value = useMemo(() => ({
        rows, summary, historicalPnl, dailyPnlList, dailyPnlResults, pnlEvents: contextPnlEvents, auditTrail: structuralData.auditTrail,
        fullEodMap, ytdBaseEodMap, activeSplits, loading: txLoading || eodLoading || isM14Calculating || isRebuilding,
        transactions, isCalculating: txLoading || eodLoading || isM14Calculating || isRebuilding,
        refreshData: () => setRefreshVersion(v => v + 1),
        analysisYear, setAnalysisYear, showHidden, setShowHidden, toggleHidden,
        effectiveUid, availableYears, allTransactions,
        // [NEW] Expose snapshot meta
        snapshotLoaded: !!latestSnapshot,
        snapshotDate: latestSnapshot?.date,
        rebuildHistory, isRebuilding,
        isAutoHealing, autoHealProgress, // [NEW]
        isLiveMode // [NEW]
    }), [rows, summary, historicalPnl, dailyPnlList, dailyPnlResults, contextPnlEvents, structuralData.auditTrail, fullEodMap, ytdBaseEodMap, activeSplits, txLoading, eodLoading, isM14Calculating, transactions, analysisYear, showHidden, toggleHidden, effectiveUid, availableYears, allTransactions, latestSnapshot, rebuildHistory, isRebuilding, isAutoHealing, autoHealProgress, isLiveMode]);

    return <HoldingsContext.Provider value={value}>{children}</HoldingsContext.Provider>;
}

export const useHoldingsContext = () => {
    const context = useContext(HoldingsContext);
    if (!context) throw new Error('useHoldings must be used within HoldingsProvider');
    return context;
};
