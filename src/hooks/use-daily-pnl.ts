'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/firebase';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { getOfficialCloses, getOfficialClosesRange, OfficialCloseResult } from '@/lib/data/official-close-repo';
import { calcM14DailyCalendar } from '@/lib/pnl/calc-m14-daily-calendar';
import { getActiveSymbols } from '@/lib/holdings/active-symbols'; // [NEW]
import { normalizeSymbolClient } from '@/lib/utils';
import { startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { toNyCalendarDayString, prevNyTradingDayString } from '@/lib/ny-time';

export function useDailyPnl(currentMonth: Date) {
    const { user } = useUser();
    const { data: transactions, loading: txLoading } = useUserTransactions(user?.uid);

    const [eodMap, setEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [loading, setLoading] = useState(false);

    const { targetDates, uniqueSymbols, prevMonthEnd } = useMemo(() => {
        // Even if no transactions, we need to calculate dates for the calendar grid
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);

        // All days in the current month
        const days = eachDayOfInterval({ start, end });

        // Include all calendar days (trading + non-trading)
        const dates = days.map(d => toNyCalendarDayString(d));

        // Determine the "base date" for the first day of the month (i.e., last trading day of prev month)
        const firstDate = dates.length > 0 ? dates[0] : toNyCalendarDayString(start);
        const prevEnd = prevNyTradingDayString(firstDate);

        // [OPTIMIZED] Only fetch symbols active in this month (Held at start OR Traded during month)
        // This prevents fetching EOD for long-closed positions.
        const monthStartStr = toNyCalendarDayString(start);
        const monthEndStr = toNyCalendarDayString(end);
        const activeSymbols = getActiveSymbols(transactions || [], monthStartStr, monthEndStr);

        return {
            targetDates: dates,
            prevMonthEnd: prevEnd,
            uniqueSymbols: activeSymbols
        };
    }, [currentMonth, transactions]);

    // 2. Fetch EOD data
    useEffect(() => {
        if (uniqueSymbols.length === 0) return;

        let cancelled = false;

        const fetchData = async () => {
            setLoading(true);
            try {
                // Optimization: Fetch range for the current month + single fetch for prev month end
                // [FIX] Do NOT fetch YTD (startOfYear) here. It's too heavy and fragile.
                // We only need the current month's EODs + the baseline calculation.
                const rangeStart = startOfMonth(currentMonth);
                const rangeEnd = endOfMonth(currentMonth);

                const startStr = toNyCalendarDayString(rangeStart);
                const endStr = toNyCalendarDayString(rangeEnd);

                console.log(`[useDailyPnl] Fetching EOD Data. Range: ${startStr} -> ${endStr}. Baseline: ${prevMonthEnd}`);

                // 2. Fetch Prev Month End (Reference Date)
                const p1 = getOfficialCloses(prevMonthEnd, uniqueSymbols);

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
