'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameMonth, isToday, parseISO, startOfMonth, startOfToday, subMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useHoldings } from '@/hooks/use-holdings';
import { cn } from '@/lib/utils';

export function DailyPnlCalendar() {
    const { dailyPnlList, loading } = useHoldings();
    const [currentMonth, setCurrentMonth] = React.useState(startOfToday());

    const dataMap = React.useMemo(() => {
        const map = new Map<string, number>();
        if (dailyPnlList) {
            dailyPnlList.forEach(item => {
                map.set(item.date, item.pnl);
            });
        }
        return map;
    }, [dailyPnlList]);

    const days = React.useMemo(() => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        return eachDayOfInterval({ start, end });
    }, [currentMonth]);

    // Calculate total PnL for the month
    const monthPnl = React.useMemo(() => {
        let total = 0;
        days.forEach(day => {
            const dateKey = format(day, 'yyyy-MM-dd');
            total += dataMap.get(dateKey) || 0;
        });
        return total;
    }, [days, dataMap]);

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
            <Card className="h-[400px] flex items-center justify-center">
                <div className="text-muted-foreground">加载中...</div>
            </Card>
        );
    }

    return (
        <Card className="col-span-1 md:col-span-2 lg:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex flex-col space-y-1">
                    <CardTitle className="text-base font-medium">
                        {format(currentMonth, 'yyyy年 MM月', { locale: zhCN })} / 收益日历
                    </CardTitle>
                    <div className={cn("text-2xl font-bold", monthPnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                        {monthPnl >= 0 ? '+' : ''}{monthPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div className="flex items-center space-x-1">
                    <Button variant="outline" size="icon" onClick={previousMonth}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={nextMonth}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-7 gap-2 text-center text-sm mt-4">
                    {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                        <div key={day} className="text-muted-foreground font-medium py-2">
                            {day}
                        </div>
                    ))}
                    {days.map((day, dayIdx) => {
                        const dateKey = format(day, 'yyyy-MM-dd');
                        const pnl = dataMap.get(dateKey);
                        const hasData = pnl !== undefined;
                        const isProfit = (pnl || 0) >= 0;
                        const isTodayDate = isToday(day);

                        return (
                            <div
                                key={day.toString()}
                                className={cn(
                                    dayIdx === 0 && colStartClasses[getDay(day)],
                                    "relative flex flex-col items-center justify-center rounded-lg border p-2 h-20 transition-colors",
                                    hasData && isProfit && "bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900",
                                    hasData && !isProfit && "bg-rose-50/50 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900",
                                    !hasData && "bg-background border-transparent hover:bg-muted/50",
                                    isTodayDate && "ring-2 ring-primary ring-offset-2"
                                )}
                            >
                                <time dateTime={dateKey} className={cn("text-xs font-medium mb-1", isTodayDate && "text-primary")}>
                                    {format(day, 'd')}
                                </time>
                                {hasData && (
                                    <span className={cn(
                                        "text-xs font-bold truncate w-full",
                                        isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                    )}>
                                        {pnl! > 0 ? '+' : ''}{pnl!.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
