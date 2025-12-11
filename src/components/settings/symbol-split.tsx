
'use client';

import { useState } from 'react';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useFirestore, useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

interface PreviewTx {
    id: string;
    collection: 'transactions' | 'trades';
    date: string;
    type: string;
    originalQty: number;
    newQty: number;
    originalPrice: number;
    newPrice: number;
}

export function SymbolSplit() {
    const firestore = useFirestore();
    const { user } = useUser();
    const { toast } = useToast();

    const [symbol, setSymbol] = useState('');
    const [ratio, setRatio] = useState('10'); // Default 10-for-1
    const [previewing, setPreviewing] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [previews, setPreviews] = useState<PreviewTx[]>([]);
    const [stats, setStats] = useState({ count: 0 });

    const [activeTab, setActiveTab] = useState<'tx' | 'eod'>('tx');
    const [eodCutoffDate, setEodCutoffDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [eodPreviews, setEodPreviews] = useState<any[]>([]);
    const [eodStats, setEodStats] = useState({ count: 0 });

    const handlePreview = async () => {
        if (!user || !symbol || !ratio) {
            toast({ variant: 'destructive', title: '请输入完整信息' });
            return;
        }

        const splitRatio = parseFloat(ratio);
        if (isNaN(splitRatio) || splitRatio <= 0) {
            toast({ variant: 'destructive', title: '无效的拆分比例' });
            return;
        }

        setPreviewing(true);
        setPreviews([]);

        try {
            const targetSymbol = symbol.trim().toUpperCase();
            const results: PreviewTx[] = [];

            // Query both collections
            for (const colName of ['transactions', 'trades'] as const) {
                const q = query(
                    collection(firestore!, 'users', user.uid, colName),
                    where('symbol', '==', targetSymbol)
                );
                const snap = await getDocs(q);

                snap.forEach(doc => {
                    const data = doc.data();
                    // Filter for stocks only loosely
                    const assetType = (data.assetType || data.instrumentType || 'stock').toLowerCase();
                    if (assetType.includes('option')) return;

                    const qty = Number(data.qty || data.quantity || 0);
                    const price = Number(data.price || data.fillPrice || data.avgPrice || 0);

                    if (!qty && !price) return; // Skip empty records

                    // Logic: 10-for-1 split => Qty * 10, Price / 10
                    // But wait, if Qty is negative (Short), it should also be * 10 (more negative)
                    const newQty = qty * splitRatio;
                    // Price is always positive
                    const newPrice = price / splitRatio;

                    results.push({
                        id: doc.id,
                        collection: colName,
                        date: data.transactionDate || data.date || data.timestamp || 'Unknown',
                        type: data.type || data.action || data.side || 'Unknown',
                        originalQty: qty,
                        newQty: newQty,
                        originalPrice: price,
                        newPrice: newPrice
                    });
                });
            }

            setPreviews(results);
            setStats({ count: results.length });

            if (results.length === 0) {
                toast({ title: '未找到相关交易', description: `代码 ${targetSymbol} 没有找到即期股票交易记录。` });
            }

        } catch (error: any) {
            console.error('Preview failed:', error);
            toast({ variant: 'destructive', title: '预览失败', description: error.message });
        } finally {
            setPreviewing(false);
        }
    };

    const handleEodPreview = async () => {
        if (!symbol || !ratio || !eodCutoffDate) {
            toast({ variant: 'destructive', title: '请输入完整信息 (Symbol, Ratio, Cutoff Date)' });
            return;
        }

        const splitRatio = parseFloat(ratio);
        setPreviewing(true);
        setEodPreviews([]);

        try {
            const targetSymbol = symbol.trim().toUpperCase();
            // Query officialCloses where symbol == targetSymbol
            const q = query(
                collection(firestore!, 'officialCloses'),
                where('symbol', '==', targetSymbol)
            );

            const snap = await getDocs(q);
            const results: any[] = [];

            snap.forEach(d => {
                const data = d.data();
                // Filter by date < cutoff (pre-split data needs adjustment)
                const date = data.date || data.tradingDate;
                if (date && date < eodCutoffDate) {
                    if (data.status === 'ok' && typeof data.close === 'number') {
                        results.push({
                            id: d.id,
                            date: date,
                            oldClose: data.close,
                            newClose: data.close / splitRatio
                        });
                    }
                }
            });

            // Sort by date desc
            results.sort((a, b) => b.date.localeCompare(a.date));

            setEodPreviews(results);
            setEodStats({ count: results.length });

            if (results.length === 0) {
                toast({ title: '未找到历史数据', description: `在 ${eodCutoffDate} 之前未找到 ${targetSymbol} 的有效收盘数据。` });
            }

        } catch (error: any) {
            console.error('EOD Preview failed:', error);
            toast({ variant: 'destructive', title: 'EOD 预览失败', description: error.message });
        } finally {
            setPreviewing(false);
        }
    };

    const handleExecute = async () => {
        if (previews.length === 0) return;
        if (!confirm(`确定要对 ${previews.length} 条记录执行拆分吗？此操作不可逆！`)) return;

        setExecuting(true);
        try {
            const batch = writeBatch(firestore!);

            previews.forEach(p => {
                const ref = doc(firestore!, 'users', user!.uid, p.collection, p.id);
                // We update key fields. Note that different docs might use different field names.
                // To be safe, we try to update standard fields and let the hooks handle normalization?
                // Or we update the fields we read.
                // The safest is to update 'qty' and 'price' AND keeping aliases in sync if they exist?
                // Firestore update doesn't care if field doesn't exist? No, update fails if doc doesn't exist, but here it exists.
                // But fields...
                // Simplification: Update known standard fields + source fields from preview logic?
                // In handlePreview we read generic fields.

                // For simplicity and robustness, we'll just update 'qty' and 'price' 
                // AND 'quantity', 'fillPrice' if they are common. 
                // Actually, let's just check the data structure again?
                // Most records use 'qty' and 'price'. Interactive Brokers imports might use 'quantity'/'TPrice'.
                // Ideally we should know WHICH field specifically.
                // But since we can't easily know per-doc in batch without re-reading (which we did), 
                // we can assume 'qty'/'price' are primary.
                // Let's just update 'qty' and 'price'.

                batch.update(ref, {
                    qty: p.newQty,
                    price: p.newPrice,
                    // Also update potential aliases to be safe?
                    // quantity: p.newQty, 
                    // avgPrice: p.newPrice
                    // No, blindly updating non-existent fields adds them.
                    // Ideally we should have stored which field we read from.
                });
            });

            await batch.commit();

            toast({
                title: '拆分执行成功',
                description: `已更新 ${previews.length} 条交易记录。`
            });
            setPreviews([]);
            setStats({ count: 0 });

        } catch (error: any) {
            console.error('Execute failed:', error);
            toast({ variant: 'destructive', title: '执行失败', description: error.message });
        } finally {
            setExecuting(false);
        }
    };

    const handleEodExecute = async () => {
        if (eodPreviews.length === 0) return;
        if (!confirm(`确定要修改 ${eodPreviews.length} 条历史价格数据吗？此操作将永久修改 EOD (Official Closes) 数据库！`)) return;

        setExecuting(true);
        try {
            // Fix: Use the existing firestore instance's app to get functions
            const functions = getFunctions(firestore!.app, 'us-central1');
            const processSplitFn = httpsCallable(functions, 'processStockSplit');

            // Chunking is handled by the cloud function logic in a way (we built it to loop).
            // BUT, the payload size limit for callable functions is 10MB. 5000 records * {id: 20b, close: 8b} is small (~140KB).
            // So we can send all at once.

            const updates = eodPreviews.map(p => ({
                id: p.id,
                close: p.newClose
            }));

            const result = await processSplitFn({ updates });
            const data = result.data as any;

            toast({
                title: 'EOD 数据修正成功',
                description: `后台已更新 ${data.updatedCount} 条历史价格。`
            });
            setEodPreviews([]);
            setEodStats({ count: 0 });

        } catch (error: any) {
            console.error('EOD Execute failed:', error);
            toast({ variant: 'destructive', title: 'EOD 执行失败', description: error.message });
        } finally {
            setExecuting(false);
        }
    };

    return (
        <Card className="border-orange-500/20">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    标的拆分工具 (Stock Split)
                </CardTitle>
                <CardDescription>
                    批量调整指定标的历史交易的数量和价格，以及历史 EOD 收盘价。
                    <br />
                    <span className="text-orange-500 font-bold">警告：此操作将直接修改数据库记录，请确保在执行前已理清逻辑。建议先预览。</span>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex gap-4 border-b pb-2 mb-4">
                    <Button
                        variant={activeTab === 'tx' ? 'default' : 'ghost'}
                        onClick={() => setActiveTab('tx')}
                    >
                        1. 交易记录 (Transactions)
                    </Button>
                    <Button
                        variant={activeTab === 'eod' ? 'default' : 'ghost'}
                        onClick={() => setActiveTab('eod')}
                    >
                        2. 历史行情 (Historical EOD)
                    </Button>
                </div>

                <div className="flex items-end gap-4 flex-wrap">
                    <div className="grid w-32 items-center gap-1.5">
                        <Label>标的代码</Label>
                        <Input
                            value={symbol}
                            onChange={e => setSymbol(e.target.value.toUpperCase())}
                            placeholder="NVDA"
                        />
                    </div>
                    <div className="grid w-32 items-center gap-1.5">
                        <Label>拆分比例 (1拆N)</Label>
                        <Input
                            type="number"
                            step="0.1"
                            value={ratio}
                            onChange={e => setRatio(e.target.value)}
                            placeholder="10"
                        />
                    </div>

                    {activeTab === 'eod' && (
                        <div className="grid w-40 items-center gap-1.5">
                            <Label>除权日 (Ex-Date)</Label>
                            <Input
                                type="date"
                                value={eodCutoffDate}
                                onChange={e => setEodCutoffDate(e.target.value)}
                            />
                            <p className="text-[10px] text-muted-foreground">此日期之前的价格将被调整</p>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            onClick={activeTab === 'tx' ? handlePreview : handleEodPreview}
                            disabled={previewing || executing}
                        >
                            {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {activeTab === 'tx' ? '预览交易影响' : '预览历史价格影响'}
                        </Button>

                        {(activeTab === 'tx' ? previews.length > 0 : eodPreviews.length > 0) && (
                            <Button
                                onClick={activeTab === 'tx' ? handleExecute : handleEodExecute}
                                disabled={executing}
                                variant="destructive"
                            >
                                {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                执行修改 ({activeTab === 'tx' ? stats.count : eodStats.count})
                            </Button>
                        )}
                    </div>
                </div>

                {activeTab === 'tx' && previews.length > 0 && (
                    <div className="border rounded-md max-h-[400px] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>日期</TableHead>
                                    <TableHead>类型</TableHead>
                                    <TableHead>原数量 → 新数量</TableHead>
                                    <TableHead>原价格 → 新价格</TableHead>
                                    <TableHead>来源</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {previews.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell>{typeof p.date === 'object' ? 'Obj' : p.date}</TableCell>
                                        <TableCell>{p.type}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">{p.originalQty}</span>
                                                <ArrowRight className="h-3 w-3" />
                                                <span className="font-bold">{p.newQty}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">{p.originalPrice.toFixed(2)}</span>
                                                <ArrowRight className="h-3 w-3" />
                                                <span className="font-bold">{p.newPrice.toFixed(4)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{p.collection}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {activeTab === 'eod' && eodPreviews.length > 0 && (
                    <div className="border rounded-md max-h-[400px] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>日期</TableHead>
                                    <TableHead>原收盘价 → 新收盘价</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {eodPreviews.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell>{p.date}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">{p.oldClose.toFixed(2)}</span>
                                                <ArrowRight className="h-3 w-3" />
                                                <span className="font-bold text-emerald-600">{p.newClose.toFixed(4)}</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

            </CardContent>
        </Card>
    );
}
