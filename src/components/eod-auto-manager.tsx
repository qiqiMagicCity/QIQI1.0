
'use client';

import { useEffect, useRef } from 'react';
import { useHoldings } from '@/hooks/use-holdings';
import { useRealTimePrices } from '@/price/useRealTimePrices';
import { getOfficialCloses, saveRealTimeAsEod } from '@/lib/data/official-close-repo';
import { prevNyTradingDayString, toNyCalendarDayString, isNyTradingDay, toNyHmsString, nyWeekdayIndex, US_MARKET_HOLIDAYS } from '@/lib/ny-time';
import { useToast } from '@/hooks/use-toast';

export function EodAutoManager() {
    const { rows: holdings } = useHoldings();
    const { get: getPrice } = useRealTimePrices(holdings.map(h => h.symbol));
    const { toast } = useToast();

    // Refs to prevent duplicate runs in strict mode or rapid re-renders
    const hasRunBackfill = useRef(false);
    const lastSnapshotDate = useRef<string | null>(null);

    // 1. Auto Backfill (Historical Data)
    useEffect(() => {
        if (hasRunBackfill.current || holdings.length === 0) return;

        const runBackfill = async () => {
            hasRunBackfill.current = true;
            const todayNy = toNyCalendarDayString(new Date());
            const prevDay = prevNyTradingDayString(todayNy);
            const symbols = holdings.map(h => h.symbol);

            console.log(`[EodAutoManager] Checking backfill for ${prevDay}...`);

            // Check if we have data for previous trading day
            const results = await getOfficialCloses(prevDay, symbols, { shouldAutoRequestBackfill: true });

            const missingCount = Object.values(results).filter(r => r.status !== 'ok').length;
            if (missingCount > 0) {
                toast({
                    title: '正在自动修复历史数据',
                    description: `发现 ${missingCount} 个代码缺失 ${prevDay} 的数据，已触发自动修复。`,
                });
            }
        };

        // Delay slightly to ensure app is stable
        const timer = setTimeout(runBackfill, 3000);
        return () => clearTimeout(timer);
    }, [holdings, toast]);

    // 3. Auto Snapshot (Today's Close)
    useEffect(() => {
        const checkAndSnapshot = async () => {
            const now = new Date();
            const todayNy = toNyCalendarDayString(now);

            // Prevent duplicate snapshots for the same day
            if (lastSnapshotDate.current === todayNy) return;

            // Check if market is closed (after 16:00 NY time)
            // Simple check: > 16:05 to be safe
            const [hh, mm] = toNyHmsString(now).split(':').map(Number);
            const timeVal = hh * 100 + mm;

            // Only run if it's a trading day and time is past 16:05
            if (!isNyTradingDay(todayNy) || timeVal < 1605) return;

            console.log('[EodAutoManager] Market closed, checking if snapshot needed...');

            // Check if we already have EOD for today
            const symbols = holdings.map(h => h.symbol);
            if (symbols.length === 0) return;

            const results = await getOfficialCloses(todayNy, symbols, { shouldAutoRequestBackfill: false });

            let savedCount = 0;
            for (const sym of symbols) {
                // If missing or error, try to save snapshot
                if (results[sym]?.status !== 'ok') {
                    const priceRec = getPrice(sym);
                    if (priceRec && priceRec.price) {
                        await saveRealTimeAsEod(todayNy, sym, priceRec.price);
                        savedCount++;
                    }
                }
            }

            if (savedCount > 0) {
                lastSnapshotDate.current = todayNy;
                toast({
                    title: '自动快照完成',
                    description: `已自动保存 ${savedCount} 个持仓的今日收盘价。`,
                });
            }
        };

        // Check every minute
        const interval = setInterval(checkAndSnapshot, 60000);

        // Also run once immediately
        checkAndSnapshot();

        return () => clearInterval(interval);
    }, [holdings, getPrice, toast]);

    return null; // Renderless component
}
