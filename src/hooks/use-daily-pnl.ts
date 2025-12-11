'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/firebase';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { getOfficialCloses, getOfficialClosesRange, OfficialCloseResult } from '@/lib/data/official-close-repo';
import { calcM14DailyCalendar } from '@/lib/pnl/calc-m14-daily-calendar';
import { normalizeSymbolClient } from '@/lib/utils';
import { startOfMonth, endOfMonth, eachDayOfInterval, startOfYear } from 'date-fns';
import { toNyCalendarDayString, prevNyTradingDayString, isNyTradingDay } from '@/lib/ny-time';

export function useDailyPnl(currentMonth: Date) {
    const { user } = useUser();
    const { data: transactions, loading: txLoading } = useUserTransactions(user?.uid);

    const [eodMap, setEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [loading, setLoading] = useState(false);

    // 1. Determine date range and symbols
    const { targetDates, uniqueSymbols, prevMonthEnd } = useMemo(() => {
        // Even if no transactions, we need to calculate dates for the calendar grid
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);

        // All days in the current month
        const days = eachDayOfInterval({ start, end });

        // Include all calendar days (trading + non-trading)
        // The calculation logic (M14) now handles market_closed mapping internally.
        const dates = days.map(d => toNyCalendarDayString(d));

        // Determine the "base date" for the first day of the month (i.e., last trading day of prev month)
        // If dates is empty (e.g. month hasn't started or no trading days yet?), we still try to find prev month end
        const firstDate = dates.length > 0 ? dates[0] : toNyCalendarDayString(start);
        const prevEnd = prevNyTradingDayString(firstDate);

        // Collect symbols from transactions
        const symbols = new Set<string>();
        if (transactions) {
            transactions.forEach(tx => symbols.add(normalizeSymbolClient(tx.symbol)));
        }

        return {
            targetDates: dates,
            prevMonthEnd: prevEnd,
            uniqueSymbols: Array.from(symbols)
        };
    }, [currentMonth, transactions]);

    // 2. Fetch EOD data
    useEffect(() => {
        if (uniqueSymbols.length === 0) return;

        let cancelled = false;

        const fetchData = async () => {
            setLoading(true);
            try {
                // Optimization: Fetch range for the whole month + single fetch for prev month end
                // [MODIFIED] Fetch YTD (from Start of Year) to ensure we have context and data for past months
                const rangeStart = startOfYear(currentMonth);
                const rangeEnd = endOfMonth(currentMonth);

                const startStr = toNyCalendarDayString(rangeStart);
                const endStr = toNyCalendarDayString(rangeEnd);

                // 2. Fetch Prev Month End (Reference Date)
                const p1 = getOfficialCloses(prevMonthEnd, uniqueSymbols, { shouldAutoRequestBackfill: true });

                const p2 = getOfficialClosesRange(startStr, endStr, uniqueSymbols);

                const [prevCloseMap, rangeMap] = await Promise.all([p1, p2]);

                if (cancelled) return;

                const results: Record<string, OfficialCloseResult> = { ...rangeMap };

                // Add prev month end results (need to rekey manually as getOfficialCloses returns {Symbol: Result})
                Object.entries(prevCloseMap).forEach(([sym, res]) => {
                    results[`${prevMonthEnd}_${sym}`] = res;
                });

                setEodMap(prev => ({ ...prev, ...results }));
            } catch (err) {
                console.error("Failed to fetch daily PnL EOD data", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchData();

        return () => { cancelled = true; };
    }, [targetDates, prevMonthEnd, uniqueSymbols]);

    // 3. Calculate M14
    const dailyPnlResults = useMemo(() => {
        if (txLoading || !transactions) return {};

        // We pass the full list of dates we want to see on the calendar
        return calcM14DailyCalendar(transactions, targetDates, eodMap);
    }, [transactions, txLoading, targetDates, eodMap]);

    return {
        dailyPnlResults,
        loading: txLoading || loading
    };
}
