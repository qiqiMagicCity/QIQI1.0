"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDailyPnl } from "@/hooks/use-daily-pnl";
import { useHoldings } from "@/hooks/use-holdings";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isSameYear } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, RefreshCcw } from "lucide-react";
import { getEffectiveTradingDay } from "@/lib/ny-time";
import { triggerManualBackfill } from "@/lib/data/official-close-repo";
import { toast } from "sonner";
import { DailyPnlBreakdownDialog } from '@/components/dashboard/daily-pnl-breakdown-dialog';

export function DailyPnlCalendar() {
    const todayNy = getEffectiveTradingDay();
    // [COMPLIANT] Rule 2.1: Initialize calendar view based on NY Date, not local browser time.
    // parse yyyy-mm-dd string to local Date object (midnight) for UI control state
    const [currentMonth, setCurrentMonth] = React.useState(() => {
        const [y, m, d] = todayNy.split('-').map(Number);
        return new Date(y, m - 1, d);
    });
    const [selectedDate, setSelectedDate] = React.useState<string | null>(null);

    // Check if the viewed month is the current NY month
    const isCurrentMonth = isSameMonth(currentMonth, new Date(Number(todayNy.substring(0, 4)), Number(todayNy.substring(5, 7)) - 1, 1));

    const { dailyPnlResults: hookResults, loading: hookLoading } = useDailyPnl(currentMonth);
    const { summary, dailyPnlResults: providerResults, loading: providerLoading, isCalculating } = useHoldings();

    // [FIX] Use Provider results ONLY for current month (provides live/today updates).
    // For historical months (even within same year), rely on 'hookResults' 
    // because 'useDailyPnl' explicitly correctly fetches/backfills historical EOD data for the entire range.
    // 'providerResults' (Global Context) might lazy-load or miss historical chunks depending on optimization.
    const dailyPnlResults = isCurrentMonth ? providerResults : hookResults;
    const loading = isCurrentMonth ? providerLoading : hookLoading;

    // Calculate total PnL for the month
    const monthPnl = React.useMemo(() => {
        let total = 0;
        Object.values(dailyPnlResults).forEach(res => {
            if (res.date.startsWith(format(currentMonth, 'yyyy-MM'))) {
                // For current month, providerResults already has Today's M6 injected and status='ok'
                if (res.status === 'ok' || res.status === 'partial') {
                    total += res.totalPnl;
                }
            }
        });
        return total;
    }, [dailyPnlResults, currentMonth]);

    // [NEW] Identify missing items for the report
    const missingItems = React.useMemo(() => {
        const items: { date: string, symbols: string[] }[] = [];
        Object.values(dailyPnlResults).forEach(res => {
            // Only care about this month's missing data to keep list relevant
            // [FIX] Ignore future dates (e.g. 2026-01-02) as they are naturally missing EOD
            if (res.date.startsWith(format(currentMonth, 'yyyy-MM')) && res.date <= todayNy) {
                if (res.status === 'missing-data' && res.missingSymbols && res.missingSymbols.length > 0) {
                    items.push({ date: res.date, symbols: res.missingSymbols });
                }
            }
        });
        return items.sort((a, b) => a.date.localeCompare(b.date));
    }, [dailyPnlResults, currentMonth, todayNy]);

    const handleManualBackfill = async (date: string, symbols: string[]) => {
        try {
            toast.info(`正在请求补录 ${date} 的数据...`);
            await triggerManualBackfill(date, symbols);
            toast.success(`已发送补录请求，请稍候...`);
        } catch (e) {
            toast.error("补录请求失败，请检查网络或日志");
        }
    };

    const previousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

    // Grid alignment: The first day of the month needs to be aligned.
    // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    const colStartClasses = [
        '',
        'col-start-2',
        'col-start-3',
        'col-start-4',
        'col-start-5',
        'col-start-6',
        'col-start-7',
    ];

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>每日盈亏日历</CardTitle>
                </CardHeader>
                <CardContent className="h-[300px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start, end });

    return (
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl">
            {/* [NEW] Full Overlay Loading State */}
            {isCalculating && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/60 backdrop-blur-sm transition-all duration-300">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mb-2" />
                    <span className="text-xs font-medium text-emerald-400/80 tracking-wider">Updating Data...</span>
                </div>
            )}
            {/* Glassmorphic Header */}
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <h3 className="text-sm font-medium tracking-wide text-zinc-100">每日盈亏日历 (Total PnL)</h3>
                    {/* [NEW] Calculation Loading State */}
                    {isCalculating && (
                        <div className="flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                            <span className="text-[10px] font-medium text-emerald-400">Updating...</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={previousMonth}
                        className="group rounded-lg p-1 text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
                    >
                        <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                    </button>
                    <span className="w-20 text-center font-mono text-sm font-bold text-zinc-200">
                        {format(currentMonth, 'yyyy-MM')}
                    </span>
                    <button
                        onClick={nextMonth}
                        className="group rounded-lg p-1 text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
                    >
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                </div>
            </div>

            {/* Content Container with optional opacity transition */}
            <div className={cn("p-4 transition-opacity duration-200", isCalculating && "opacity-60 grayscale-[0.3]")}>
                {/* Monthly Summary with Glow */}
                <div className="mb-6 text-center">
                    <div className="relative inline-block">
                        <span className={cn(
                            "font-mono text-3xl font-bold tracking-tight",
                            monthPnl > 0 ? "text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.4)]" :
                                (monthPnl < 0 ? "text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.4)]" : "text-zinc-500")
                        )}>
                            {monthPnl > 0 ? '+' : ''}{monthPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {monthPnl !== 0 && (
                            <div className={cn(
                                "absolute -inset-4 -z-10 rounded-full blur-2xl opacity-20",
                                monthPnl > 0 ? "bg-emerald-500" : "bg-rose-500"
                            )} />
                        )}
                    </div>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">本月累计盈亏</p>
                </div>

                {/* Grid Header */}
                <div className="mb-2 grid grid-cols-7 gap-1 text-center">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <div key={day} className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1.5">
                    {days.map((day, dayIdx) => {
                        const dateKey = format(day, 'yyyy-MM-dd');
                        const res = dailyPnlResults[dateKey];

                        // Values
                        let total = res?.totalPnl;
                        const realized = res?.realizedPnl;
                        const unrealizedChange = res?.unrealizedPnlChange;

                        let isMissingData = res?.status === 'missing-data';
                        let isMarketClosed = res?.status === 'market-closed';
                        let isToday = dateKey === todayNy;
                        const isFuture = dateKey > todayNy; // [NEW] Identify future dates

                        // [FIX] Do not flag future dates as missing data
                        if (isFuture) {
                            isMissingData = false;
                        }

                        // Fallback injection for Today if Provider logic missed it (redundant if Provider is fixed)
                        if (isToday && isMissingData && summary.m6_total != null) {
                            total = summary.m6_total;
                            isMissingData = false;
                            isMarketClosed = false; // Assume if we have live data, market is likely open or we have finalized data
                            // Note: We can't easily guess breakdown here without events, keeping it simple if fallback triggers
                        }

                        const hasData = total !== undefined;
                        const isProfit = (total || 0) > 0;
                        const isLoss = (total || 0) < 0;

                        // Formatting helper
                        const fmt = (n: number | undefined) => {
                            if (n === undefined) return '-';
                            return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
                        };

                        const fmtFull = (n: number | undefined) => n !== undefined ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

                        return (
                            <div
                                key={day.toString()}
                                className={cn(
                                    "group relative flex flex-col justify-between rounded-lg border transition-all duration-300 min-h-[90px] p-2",
                                    dayIdx === 0 && colStartClasses[day.getDay()],

                                    // Base Styles
                                    "bg-zinc-900/30 backdrop-blur-sm",

                                    // Today Styles (Glowing Border)
                                    isToday ? "border-emerald-500/50 ring-1 ring-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)] z-10" : "border-white/5",

                                    // PnL Styles (Gradient Backgrounds) -> Only for open market days
                                    !isMarketClosed && hasData && !isMissingData && isProfit && "bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 hover:from-emerald-500/20",
                                    !isMarketClosed && hasData && !isMissingData && isLoss && "bg-gradient-to-br from-rose-500/10 to-rose-500/5 border-rose-500/20 hover:border-rose-500/40 hover:from-rose-500/20",

                                    // Market Closed Style (Dimmed)
                                    isMarketClosed && "bg-zinc-900/10 opacity-75 border-transparent",

                                    // Hover Lift
                                    !isToday && "hover:-translate-y-1 hover:shadow-lg hover:z-10",
                                    "cursor-pointer" // [NEW] Make interactive
                                )}
                                onClick={() => setSelectedDate(dateKey)}
                                title={isMissingData ? "EOD数据待更新" :
                                    isMarketClosed ? "市场休市" :
                                        (hasData ? `Total: ${fmtFull(total)}\n存量(Stock): ${fmtFull(unrealizedChange)}\n增量(Incr): ${fmtFull(realized)}` : undefined)}
                            >
                                {/* Date Number */}
                                <div className="flex justify-between items-start">
                                    <span className={cn(
                                        "text-[10px] font-medium transition-colors",
                                        isToday ? "text-emerald-400" : "text-zinc-600 group-hover:text-zinc-400"
                                    )}>
                                        {format(day, 'd')}
                                    </span>
                                </div>

                                {/* Main PnL Value (Total) OR Status Badge */}
                                {isMarketClosed ? (
                                    <div className="flex items-center justify-center flex-1">
                                        <span className="text-[10px] font-medium text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5 bg-zinc-900/50">休市</span>
                                    </div>
                                ) : (hasData && !isMissingData ? (
                                    <div className="flex flex-col gap-1 my-1">
                                        <div className={cn(
                                            "font-mono font-bold tracking-tight text-center leading-none",
                                            Math.abs(total!) > 99999 ? "text-lg" : "text-xl", // Adaptive size
                                            isProfit ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]" :
                                                (isLoss ? "text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.3)]" : "text-zinc-500")
                                        )}>
                                            {total! > 0 ? '+' : ''}{fmt(total!)}
                                        </div>
                                    </div>
                                ) : (
                                    isMissingData ? (
                                        <div className="flex items-center justify-center flex-1">
                                            <span className="text-[10px] font-medium text-zinc-700">待更新</span>
                                        </div>
                                    ) : (
                                        isFuture ? (
                                            <div className="flex items-center justify-center flex-1">
                                                <span className="text-[10px] font-medium text-zinc-800/50">未开盘</span>
                                            </div>
                                        ) : null
                                    )
                                ))}

                                {/* Footer Stats (3 Columns: Pos, Bk, Tr) - Vertical Stack for Max Visibility */}
                                {hasData && !isMissingData && !isMarketClosed && (
                                    <div className="grid grid-cols-3 gap-0.5 border-t border-white/10 pt-1.5 mt-1">
                                        {/* Pos (Left) */}
                                        <div className="flex flex-col items-start min-w-0">
                                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider leading-none mb-0.5" title="持仓盈亏 (Unrealized + Overnight Realized)">持仓</span>
                                            <span className={cn(
                                                "text-sm font-extrabold tracking-tighter leading-none truncate w-full",
                                                ((unrealizedChange || 0) + (res?.realizedPnlPosition || 0)) >= 0 ? "text-emerald-400" : "text-rose-400"
                                            )}>
                                                {fmt((unrealizedChange || 0) + (res?.realizedPnlPosition || 0))}
                                            </span>
                                        </div>

                                        {/* Bk (Center) */}
                                        <div className="flex flex-col items-center min-w-0 border-l border-r border-white/5">
                                            <span className="text-[9px] font-bold text-indigo-400/70 uppercase tracking-wider leading-none mb-0.5" title="日内账本 (Intraday Realized via FIFO)">账本</span>
                                            <span className={cn(
                                                "text-sm font-extrabold tracking-tighter leading-none truncate w-full text-center",
                                                (res?.realizedPnlDay || 0) >= 0 ? "text-indigo-300" : "text-rose-300"
                                            )}>
                                                {fmt(res?.realizedPnlDay || 0)}
                                            </span>
                                        </div>

                                        {/* Tr (Right) */}
                                        <div className="flex flex-col items-end min-w-0">
                                            <span className="text-[9px] font-bold text-amber-500/70 uppercase tracking-wider leading-none mb-0.5" title="日内交易 (Intraday Isolated Match)">交易</span>
                                            <span className={cn(
                                                "text-sm font-extrabold tracking-tighter leading-none truncate w-full text-right",
                                                (res?.m5_1 || 0) >= 0 ? "text-amber-400" : "text-rose-400"
                                            )}>
                                                {fmt(res?.m5_1 || 0)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* [NEW] Missing EOD Report Section - Simple Text List */}
            {missingItems.length > 0 && (
                <div className="border-t border-rose-500/20 bg-rose-500/5 backdrop-blur-md p-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-3 w-3 text-rose-500" />
                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-rose-500">缺失数据清单 (Missing EOD)</h4>
                    </div>

                    <ul className="space-y-1 max-h-[100px] overflow-y-auto custom-scrollbar list-disc list-inside">
                        {missingItems.map(item => (
                            <li key={item.date} className="text-[10px] text-rose-400 font-mono">
                                <span className="font-bold">{item.date}:</span> {item.symbols.join(', ')}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Inspector Dialog */}
            <DailyPnlBreakdownDialog date={selectedDate} onClose={() => setSelectedDate(null)} />
        </div>
    );
}
