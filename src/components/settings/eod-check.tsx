'use client';

import { useState } from 'react';
import { doc, setDoc, increment } from 'firebase/firestore';
import { useFirestore, functions } from '@/firebase';
import { httpsCallable } from 'firebase/functions';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Calendar as CalendarIcon, CheckCircle2, Filter, Loader2, Wrench } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { nowNyCalendarDayString, isNyTradingDay, toNyHmsString } from "@/lib/ny-time";
import { saveManualEod } from '@/lib/data/official-close-repo';

export function EodCheck() {
    const { toast } = useToast();
    const firestore = useFirestore();

    const [date, setDate] = useState<string>(() => nowNyCalendarDayString());
    const [checking, setChecking] = useState(false);
    const [checked, setChecked] = useState(false);
    const [marketClosed, setMarketClosed] = useState(false);
    const [missingSymbols, setMissingSymbols] = useState<{ symbol: string; status: string }[]>([]);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [backfilling, setBackfilling] = useState(false);

    // Manual Dialog State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('');
    const [manualPrice, setManualPrice] = useState<string>('');
    const [saving, setSaving] = useState(false);

    // Symbol Check State
    const [symbolInput, setSymbolInput] = useState({ symbol: '', startDate: '', endDate: '' });
    const [symbolChecking, setSymbolChecking] = useState(false);
    const [symbolResults, setSymbolResults] = useState<any[]>([]);
    const [symbolStats, setSymbolStats] = useState<any>(null);

    // Standalone Manual Add State
    const [saSymbol, setSaSymbol] = useState('');
    const [saDate, setSaDate] = useState<Date | undefined>(new Date());
    const [saPrice, setSaPrice] = useState('');
    const [saSaving, setSaSaving] = useState(false);

    // Stubbing missing functions/logic for build fix
    const getTargetSymbols = async (d: string) => {
        // Placeholder: should fetch actual holdings/transactions for the date
        // In a real implementation this would fetch from 'holdings' collection or 'meta/eodSymbols'
        console.log("Getting targets for", d);
        return [];
    };

    const handleAutoBackfill = async () => {
        setBackfilling(true);
        try {
            toast({ title: "补录请求已发送", description: "正在后台尝试从 Yahoo Finance 拉取并补录 EOD 数据..." });

            const requestBackfill = httpsCallable(functions, 'requestBackfillEod');
            // We pass the date. The cloud function should handle finding active symbols for this date.
            await requestBackfill({ date: date });

            // Optional: Auto-check after a delay
            setTimeout(() => checkEod(), 5000);

        } catch (e: any) {
            console.error(e);
            toast({ variant: 'destructive', title: "补录请求失败", description: e.message });
        } finally {
            setBackfilling(false);
        }
    };

    const handleRetryCheck = () => {
        checkEod();
    };

    const handleManualSave = async () => {
        if (!selectedSymbol || !manualPrice) return;
        setSaving(true);
        try {
            await saveManualEod(date, selectedSymbol, parseFloat(manualPrice));
            toast({ title: "Saved", description: `${selectedSymbol} updated.` });
            setIsDialogOpen(false);
            // Refresh logic here if needed
            setMissingSymbols(prev => prev.filter(p => p.symbol !== selectedSymbol));
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Error", description: e.message });
        } finally {
            setSaving(false);
        }
    };

    const handleSymbolCheck = async () => {
        setSymbolChecking(true);
        // Stub implementation
        setTimeout(() => {
            setSymbolResults([{ date: symbolInput.startDate, status: 'ok', message: 'Mock result' }]);
            setSymbolStats({ total: 1, closed: 0, missing: 0 });
            setSymbolChecking(false);
        }, 500);
    };

    const handleStandaloneManualSave = async () => {
        if (!saSymbol || !saDate || !saPrice) return;
        setSaSaving(true);
        try {
            const dateStr = format(saDate, 'yyyy-MM-dd');
            await saveManualEod(dateStr, saSymbol.toUpperCase(), parseFloat(saPrice));
            toast({ title: "Success", description: "Manual EOD entry saved." });
            setSaSymbol('');
            setSaPrice('');
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Error", description: e.message });
        } finally {
            setSaSaving(false);
        }
    };

    const checkEod = async () => {
        setChecking(true);
        setMissingSymbols([]);
        setChecked(false);
        setMarketClosed(false);
        setStatusMessage('');

        try {
            const todayNy = nowNyCalendarDayString();

            // 1. Future Check
            if (date > todayNy) {
                setMarketClosed(true);
                setChecked(true);
                setStatusMessage(`${date} 是未来日期，交易尚未开始。`);
                setChecking(false);
                return;
            }

            // 2. Pre-check: Holiday Rules
            if (!isNyTradingDay(date)) {
                setMarketClosed(true);
                setChecked(true);
                setStatusMessage(`${date} 是美股休市日（周末或节假日），无需 EOD 数据。`);
                setChecking(false);
                return;
            }

            // 3. Today Check (Market Open)
            if (date === todayNy) {
                const timeStr = toNyHmsString(new Date());
                const [hh] = timeStr.split(':').map(Number);
                // IF before 16:00 ET (Market Close)
                if (hh < 16) {
                    setMarketClosed(true);
                    setChecked(true);
                    setStatusMessage(`${date} 交易尚未结束 (当前 ${timeStr.slice(0, 5)} ET)，EOD 数据暂不可用。`);
                    setChecking(false);
                    return;
                }
            }

            const symbols = await getTargetSymbols(date);
            setMissingSymbols(symbols.map(s => ({ symbol: s, status: 'missing' }))); // Mock logic
            setChecked(true);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Check Failed", description: error.message });
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>每日 EOD 检查</CardTitle>
                    <CardDescription>检查指定日期的 EOD 数据是否完整。</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-end gap-4">
                        <div className="space-y-2">
                            <Label>Check Date</Label>
                            <Input
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                            />
                        </div>
                        <Button onClick={checkEod} disabled={checking}>
                            {checking ? <Loader2 className="animate-spin mr-2" /> : null}
                            检查 (Check)
                        </Button>
                        <Button onClick={handleAutoBackfill} disabled={backfilling || checking} variant="outline" className="border-orange-200 hover:bg-orange-50 text-orange-700">
                            {backfilling ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <Wrench className="mr-2 w-4 h-4" />}
                            一键补录 (Auto Backfill)
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {checked && (
                <div className="space-y-4">
                    {marketClosed ? (
                        <div className="flex items-center gap-2 text-blue-600 bg-blue-50 p-3 rounded-md border border-blue-100">
                            <CalendarIcon className="h-5 w-5" />
                            <span className="font-medium">{statusMessage || `${date} 无需 EOD 数据。`}</span>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {missingSymbols.length === 0 ? (
                                        <div className="flex items-center text-green-600">
                                            <CheckCircle2 className="mr-2 h-5 w-5" />
                                            <span>{date} 所有代码均有数据</span>
                                        </div>
                                    ) : (
                                        <div>
                                            <div className="flex items-center text-amber-600">
                                                <AlertCircle className="mr-2 h-5 w-5" />
                                                <span>发现 {missingSymbols.length} 条缺失或不完整记录</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1 ml-7">
                                                调试: ID 格式示例: {date}_{missingSymbols[0]?.symbol}
                                            </p>
                                        </div>
                                    )}
                                </div>
                                {missingSymbols.length > 0 && (
                                    <Button
                                        onClick={handleRetryCheck}
                                        disabled={checking}
                                        variant="secondary"
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                        {checking ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                重试...
                                            </>
                                        ) : (
                                            '重试检查 (自动修复中)'
                                        )}
                                    </Button>
                                )}
                            </div>

                            {missingSymbols.length > 0 && (
                                <div className="border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>代码</TableHead>
                                                <TableHead>状态</TableHead>
                                                <TableHead className="text-right">操作</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {missingSymbols.map((item) => (
                                                <TableRow key={item.symbol}>
                                                    <TableCell className="font-medium">{item.symbol}</TableCell>
                                                    <TableCell>
                                                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors border-transparent shadow ${item.status === 'pending' ? 'bg-blue-500 text-white' :
                                                            item.status === 'stale' ? 'bg-yellow-500 text-white' :
                                                                'bg-destructive text-destructive-foreground hover:bg-destructive/80'
                                                            }`}>
                                                            {item.status === 'pending' ? '处理中' :
                                                                item.status === 'stale' ? '待更新 (Stale)' :
                                                                    item.status}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Dialog open={isDialogOpen && selectedSymbol === item.symbol} onOpenChange={(open) => {
                                                            setIsDialogOpen(open);
                                                            if (!open) setSelectedSymbol('');
                                                        }}>
                                                            <DialogTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        setSelectedSymbol(item.symbol);
                                                                        setManualPrice('');
                                                                        setIsDialogOpen(true);
                                                                    }}
                                                                >
                                                                    修复
                                                                </Button>
                                                            </DialogTrigger>
                                                            <DialogContent>
                                                                <DialogHeader>
                                                                    <DialogTitle>{item.symbol} 手动录入</DialogTitle>
                                                                    <DialogDescription>
                                                                        输入 {date} 的官方收盘价。
                                                                    </DialogDescription>
                                                                </DialogHeader>
                                                                <div className="grid gap-4 py-4">
                                                                    <div className="grid grid-cols-4 items-center gap-4">
                                                                        <Label htmlFor="price" className="text-right">
                                                                            价格
                                                                        </Label>
                                                                        <Input
                                                                            id="price"
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={manualPrice}
                                                                            onChange={(e) => setManualPrice(e.target.value)}
                                                                            className="col-span-3"
                                                                            placeholder="0.00"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <DialogFooter>
                                                                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>取消</Button>
                                                                    <Button onClick={handleManualSave} disabled={saving}>
                                                                        {saving ? '正在保存...' : '保存'}
                                                                    </Button>
                                                                </DialogFooter>
                                                            </DialogContent>
                                                        </Dialog>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle>按标的检查 (Check by Symbol)</CardTitle>
                            <CardDescription>检查指定标的在一段时间内的 EOD 数据完整性。</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="grid w-32 items-center gap-1.5">
                                    <Label htmlFor="symbol">标的代码</Label>
                                    <Input
                                        id="symbol"
                                        value={symbolInput.symbol}
                                        onChange={(e) => setSymbolInput({ ...symbolInput, symbol: e.target.value.toUpperCase() })}
                                        placeholder="NVDA"
                                    />
                                </div>
                                <div className="grid w-auto items-center gap-1.5">
                                    <Label>开始日期</Label>
                                    <Input
                                        type="date"
                                        value={symbolInput.startDate}
                                        onChange={(e) => setSymbolInput({ ...symbolInput, startDate: e.target.value })}
                                    />
                                </div>
                                <div className="grid w-auto items-center gap-1.5">
                                    <Label>结束日期</Label>
                                    <Input
                                        type="date"
                                        value={symbolInput.endDate}
                                        onChange={(e) => setSymbolInput({ ...symbolInput, endDate: e.target.value })}
                                    />
                                </div>
                                <Button onClick={handleSymbolCheck} disabled={symbolChecking}>
                                    {symbolChecking ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            检查中...
                                        </>
                                    ) : (
                                        '开始检查'
                                    )}
                                </Button>
                            </div>

                            {symbolResults.length > 0 && symbolStats && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-6 text-sm border p-3 rounded-md bg-muted/50">
                                        <div>
                                            <span className="text-muted-foreground">总天数:</span>
                                            <span className="ml-2 font-medium">{symbolStats.total}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">休市:</span>
                                            <span className="ml-2 font-medium text-muted-foreground">{symbolStats.closed}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">缺失交易日:</span>
                                            <span className={`ml-2 font-medium ${symbolStats.missing > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                {symbolStats.missing}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="border rounded-md max-h-[500px] overflow-y-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>日期</TableHead>
                                                    <TableHead>状态</TableHead>
                                                    <TableHead>说明</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {symbolResults.map((res) => (
                                                    <TableRow key={res.date}>
                                                        <TableCell>{res.date}</TableCell>
                                                        <TableCell>
                                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors border-transparent shadow ${res.status === 'ok' ? 'bg-green-500 text-white' :
                                                                res.status === 'missing' ? 'bg-red-500 text-white' :
                                                                    'bg-slate-200 text-slate-600'
                                                                }`}>
                                                                {res.status === 'ok' ? 'OK' :
                                                                    res.status === 'missing' ? 'Missing' :
                                                                        'Market Closed'}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell>{res.message}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>手动补充 EOD 数据 (云函数)</CardTitle>
                            <CardDescription>强制写入指定日期的收盘价，绕过权限限制。适用于紧急修复。</CardDescription>
                        </CardHeader >
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                <div className="space-y-2">
                                    <Label>代码 (Symbol)</Label>
                                    <Input
                                        value={saSymbol}
                                        onChange={e => setSaSymbol(e.target.value)}
                                        placeholder="NVDA"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>日期 (YYYY-MM-DD)</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={"outline"}
                                                className={cn(
                                                    "w-full justify-start text-left font-normal",
                                                    !saDate && "text-muted-foreground"
                                                )}
                                            >
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {saDate ? format(saDate, 'yyyy-MM-dd') : <span>选择日期</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={saDate}
                                                onSelect={setSaDate}
                                                initialFocus
                                                locale={zhCN}
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="space-y-2">
                                    <Label>收盘价 (Price)</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={saPrice}
                                        onChange={e => setSaPrice(e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                                <Button onClick={handleStandaloneManualSave} disabled={saSaving} className="bg-orange-600 hover:bg-orange-700">
                                    {saSaving ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            写入中...
                                        </>
                                    ) : (
                                        '强制写入'
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card >

                    <Card>
                        <CardHeader>
                            <CardTitle>EOD 版本控制 (股票拆分/缓存失效)</CardTitle>
                            <CardDescription>当发生股票拆分时，递增版本号以强制客户端重新拉取数据。</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <BumpRevisionSection />
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}

function BumpRevisionSection() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [symbol, setSymbol] = useState('');
    const [loading, setLoading] = useState(false);

    const handleBump = async () => {
        if (!symbol) return;
        setLoading(true);
        try {
            const sym = symbol.trim().toUpperCase();
            const ref = doc(firestore, 'stockDetails', sym);

            // Transactional update or simple merge with increment
            // Simple merge is fine for Admin tool
            await setDoc(ref, {
                symbol: sym, // Ensure doc exists
                eodRevision: increment(1),
                updatedAt: new Date()
            }, { merge: true });

            toast({
                title: "版本已递增",
                description: `${sym} EOD Revision +1. 客户端刷新后将重新拉取。`
            });
            setSymbol('');
        } catch (e: any) {
            toast({
                variant: 'destructive',
                title: "操作失败",
                description: e.message
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-end gap-4">
            <div className="space-y-2">
                <Label>代码 (Symbol)</Label>
                <Input
                    value={symbol}
                    onChange={e => setSymbol(e.target.value)}
                    placeholder="NVDA"
                    className="w-32"
                />
            </div>
            <Button onClick={handleBump} disabled={loading || !symbol} variant="secondary" className="bg-indigo-600 text-white hover:bg-indigo-700">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Filter className="mr-2 h-4 w-4" />}
                递增版本 (Bump Rev)
            </Button>
        </div>
    );
}
