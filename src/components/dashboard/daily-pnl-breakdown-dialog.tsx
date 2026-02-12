'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useHoldings } from '@/hooks/use-holdings';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { useUser } from '@/firebase';
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { calcDailyAttribution, DailyAttributionResult } from '@/lib/pnl/calc-daily-attribution';
import { CompanyLogo } from '@/components/common/company-logo';

import { Card, CardContent } from '@/components/ui/card';

interface DailyPnlBreakdownDialogProps {
    date: string | null;
    onClose: () => void;
}

export function DailyPnlBreakdownDialog({ date, onClose }: DailyPnlBreakdownDialogProps) {
    const { user } = useUser();
    const { data: transactions } = useUserTransactions(user?.uid);
    // Now fullEodMap is available via context type update in previous step
    const { fullEodMap } = useHoldings();

    const [result, setResult] = useState<DailyAttributionResult | null>(null);
    const [calculating, setCalculating] = useState(false);

    useEffect(() => {
        if (!date || !transactions || !fullEodMap) return;

        setCalculating(true);
        // Using setTimeout to yield to UI thread so dialog opens smoothly
        const timer = setTimeout(() => {
            try {
                const res = calcDailyAttribution(date, transactions, fullEodMap);
                setResult(res);
            } catch (e) {
                console.error('Attribution calc failed:', e);
            } finally {
                setCalculating(false);
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [date, transactions, fullEodMap]);

    if (!date) return null;

    return (
        <Dialog open={!!date} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>每日盈亏详情: {date}</DialogTitle>
                    <DialogDescription>
                        本日已实现盈亏与持仓浮动盈亏的详细归因分析。
                    </DialogDescription>
                </DialogHeader>

                {calculating ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-muted-foreground">正在分析持仓状态...</span>
                    </div>
                ) : !result ? (
                    <div className="text-center py-8 text-muted-foreground">无法计算归因数据。</div>
                ) : (
                    <div className="flex-1 overflow-y-auto pr-4 min-h-0 relative">
                        <div className="space-y-6 pb-6">
                            {/* Summary Card */}
                            <div className="grid grid-cols-3 gap-4">
                                <Card>
                                    <div className="p-3">
                                        <div className="text-xs text-muted-foreground">总盈亏变动</div>
                                        <div className={`text-lg font-bold ${(result.totalRealized + result.totalUnrealizedChange) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            ${(result.totalRealized + result.totalUnrealizedChange).toLocaleString()}
                                        </div>
                                    </div>
                                </Card>
                                <Card>
                                    <div className="p-3">
                                        <div className="text-xs text-muted-foreground">已实现盈亏</div>
                                        <div className={`text-lg font-bold ${result.totalRealized >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            ${result.totalRealized.toLocaleString()}
                                        </div>
                                    </div>
                                </Card>
                                <Card>
                                    <div className="p-3">
                                        <div className="text-xs text-muted-foreground">持仓浮动变动</div>
                                        <div className={`text-lg font-bold ${result.totalUnrealizedChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            ${result.totalUnrealizedChange.toLocaleString()}
                                        </div>
                                    </div>
                                </Card>
                            </div>

                            {/* Realized List */}
                            {result.realizedItems.length > 0 && (
                                <div>
                                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                        已实现交易 (Realized Trades)
                                    </h3>
                                    <div className="space-y-2">
                                        {result.realizedItems.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center text-sm p-2 bg-muted/30 rounded">
                                                <div className="flex items-center gap-2">
                                                    <CompanyLogo symbol={item.symbol} size={16} />
                                                    <span className="font-medium">{item.symbol}</span>
                                                    <span className="text-muted-foreground text-xs">({item.desc})</span>
                                                </div>
                                                <div className={item.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                                                    {item.pnl > 0 ? '+' : ''}{item.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Unrealized Breakdown */}
                            <div>
                                <h3 className="font-semibold mb-2 flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                                    持仓市值变动 (Unrealized Value Changes)
                                </h3>
                                <div className="space-y-1">
                                    <div className="grid grid-cols-12 text-xs text-muted-foreground px-2 py-1">
                                        <div className="col-span-3">持仓代码</div>
                                        <div className="col-span-2 text-right">昨日收盘</div>
                                        <div className="col-span-2 text-right">今日收盘</div>
                                        <div className="col-span-2 text-right">持仓量</div>
                                        <div className="col-span-3 text-right">盈亏影响</div>
                                    </div>
                                    {result.unrealizedItems.map((item, idx) => (
                                        <div key={idx} className="grid grid-cols-12 items-center text-sm p-2 hover:bg-muted/50 rounded transition-colors border-b border-border/40 last:border-0 relative">
                                            <div className="col-span-3 flex items-center gap-2 font-medium">
                                                <CompanyLogo symbol={item.symbol} size={16} />
                                                {item.symbol}
                                            </div>
                                            <div className="col-span-2 text-right text-muted-foreground">
                                                {item.startPrice === 'MISSING' ? 'N/A' : (item.startPrice as number).toFixed(2)}
                                            </div>
                                            <div className="col-span-2 text-right">
                                                {item.endPrice === 'MISSING' ? <span className="text-red-500 font-bold">MISSING</span> : (item.endPrice as number).toFixed(2)}
                                            </div>
                                            <div className="col-span-2 text-right text-muted-foreground text-xs">
                                                {item.qty.toFixed(0)}
                                            </div>
                                            <div className={`col-span-3 text-right font-mono font-medium ${item.pnlImpact >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {item.pnlImpact > 0 ? '+' : ''}{item.pnlImpact.toLocaleString(undefined, { minimumFractionDigits: 2 })}

                                                {/* Tooltip for formula */}
                                                {(item.startPrice !== 'MISSING' && item.endPrice !== 'MISSING') && (
                                                    <span className="sr-only">
                                                        ({item.endPrice as number} - {item.startPrice as number}) * {item.qty}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {result.unrealizedItems.length === 0 && (
                                        <div className="text-center py-4 text-muted-foreground text-sm">暂无显著的持仓浮动变化。</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
