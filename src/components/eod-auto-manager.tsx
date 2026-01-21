
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

    // 1. Auto Backfill (Historical Data) - [REMOVED FOR SAFETY]
    // 1. Auto Backfill (Historical Data) - [RESTORED]
    useEffect(() => {
        const runBackfill = async () => {
            if (hasRunBackfill.current) return;

            // We always want to check the *Previous Trading Day* relative to Today.
            // Because that is the reference date for Today's PnL.
            const now = new Date();
            const todayNy = toNyCalendarDayString(now);
            const targetDate = prevNyTradingDayString(todayNy);

            // Filter symbols that need backfill
            const symbols = holdings.map(h => h.symbol);
            if (symbols.length === 0) return;

            // Check if we have data
            const results = await getOfficialCloses(targetDate, symbols);
            const missingSymbols = symbols.filter(s => !results[s] || results[s]?.status !== 'ok');

            if (missingSymbols.length > 0) {
                console.log('[EodAutoManager] Found missing EOD for:', targetDate, missingSymbols);

                // Limit batch size purely for safety, though triggerManualBackfill has checks too
                const batch = missingSymbols.slice(0, 15);

                // Import dynamically to avoid circular deps if any (though static import is fine here)
                const { triggerManualBackfill } = await import('@/lib/data/official-close-repo');

                try {
                    await triggerManualBackfill(targetDate, batch, true);
                    toast({
                        title: '自动修复数据',
                        description: `检测到 ${targetDate} 对 ${batch.length} 个标的缺失基准EOD，正在补录...`,
                    });
                } catch (e) {
                    console.error('[EodAutoManager] Auto backfill failed', e);
                }
            }

            hasRunBackfill.current = true;
        };

        // Run after meaningful delay to let holdings load
        if (holdings.length > 0) {
            const t = setTimeout(runBackfill, 2000);
            return () => clearTimeout(t);
        }
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

            const results = await getOfficialCloses(todayNy, symbols);

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
