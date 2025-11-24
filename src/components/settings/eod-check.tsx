'use client';

import { useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface MissingSymbol {
    symbol: string;
    status: string;
}

export function EodCheck() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [checking, setChecking] = useState(false);
    const [missingSymbols, setMissingSymbols] = useState<MissingSymbol[]>([]);
    const [checked, setChecked] = useState(false);

    // Manual Entry State
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [manualPrice, setManualPrice] = useState('');
    const [saving, setSaving] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const checkEod = async () => {
        setChecking(true);
        setMissingSymbols([]);
        setChecked(false);

        try {
            // 1. Get list of symbols
            const symbolsRef = doc(firestore, 'meta', 'eodSymbols');
            const symbolsSnap = await getDoc(symbolsRef);

            let symbols: string[] = [];
            if (symbolsSnap.exists()) {
                symbols = symbolsSnap.data().list || [];
            } else {
                // Fallback if meta not found
                symbols = ['AAPL', 'TSLA', 'NVDA', 'SPY', 'QQQ'];
                toast({
                    variant: 'destructive',
                    title: 'Warning',
                    description: 'Could not load symbol list. Using fallback list.',
                });
            }

            // 2. Check each symbol for the selected date
            const missing: MissingSymbol[] = [];

            // Process in chunks to avoid too many parallel requests if list is huge
            // For now, simple parallel is fine for < 100 symbols
            await Promise.all(symbols.map(async (sym) => {
                const eodId = `${date}_${sym}`;
                const eodRef = doc(firestore, 'officialCloses', eodId);
                const eodSnap = await getDoc(eodRef);

                if (!eodSnap.exists() || eodSnap.data().status !== 'ok') {
                    missing.push({
                        symbol: sym,
                        status: eodSnap.exists() ? eodSnap.data().status : 'missing'
                    });
                }
            }));

            setMissingSymbols(missing);
            setChecked(true);

        } catch (error: any) {
            console.error('Error checking EOD:', error);
            toast({
                variant: 'destructive',
                title: 'Check Failed',
                description: error.message,
            });
        } finally {
            setChecking(false);
        }
    };

    const handleManualSave = async () => {
        if (!selectedSymbol || !manualPrice) return;

        setSaving(true);
        try {
            const price = parseFloat(manualPrice);
            if (isNaN(price)) {
                throw new Error('Invalid price');
            }

            const eodId = `${date}_${selectedSymbol}`;
            const eodRef = doc(firestore, 'officialCloses', eodId);

            await setDoc(eodRef, {
                symbol: selectedSymbol,
                date: date,
                tradingDate: date,
                close: price,
                status: 'ok',
                provider: 'manual',
                updatedAt: new Date()
            });

            toast({
                title: 'Saved',
                description: `Manually set ${selectedSymbol} close to ${price}`,
            });

            // Remove from missing list
            setMissingSymbols(prev => prev.filter(s => s.symbol !== selectedSymbol));
            setIsDialogOpen(false);
            setManualPrice('');
            setSelectedSymbol(null);

        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Save Failed',
                description: error.message,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>EOD Data Check</CardTitle>
                <CardDescription>Check for missing End of Day data and manually fill gaps.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-end gap-4">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <Label htmlFor="date">Date</Label>
                        <Input
                            type="date"
                            id="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </div>
                    <Button onClick={checkEod} disabled={checking}>
                        {checking ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Checking...
                            </>
                        ) : (
                            'Check Missing Data'
                        )}
                    </Button>
                </div>

                {checked && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            {missingSymbols.length === 0 ? (
                                <div className="flex items-center text-green-600">
                                    <CheckCircle2 className="mr-2 h-5 w-5" />
                                    <span>All symbols have data for {date}</span>
                                </div>
                            ) : (
                                <div className="flex items-center text-amber-600">
                                    <AlertCircle className="mr-2 h-5 w-5" />
                                    <span>Found {missingSymbols.length} missing or incomplete records</span>
                                </div>
                            )}
                        </div>

                        {missingSymbols.length > 0 && (
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Symbol</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {missingSymbols.map((item) => (
                                            <TableRow key={item.symbol}>
                                                <TableCell className="font-medium">{item.symbol}</TableCell>
                                                <TableCell>
                                                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80">
                                                        {item.status}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Dialog open={isDialogOpen && selectedSymbol === item.symbol} onOpenChange={(open) => {
                                                        setIsDialogOpen(open);
                                                        if (!open) setSelectedSymbol(null);
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
                                                                Fix
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent>
                                                            <DialogHeader>
                                                                <DialogTitle>Manual Entry for {item.symbol}</DialogTitle>
                                                                <DialogDescription>
                                                                    Enter the official closing price for {date}.
                                                                </DialogDescription>
                                                            </DialogHeader>
                                                            <div className="grid gap-4 py-4">
                                                                <div className="grid grid-cols-4 items-center gap-4">
                                                                    <Label htmlFor="price" className="text-right">
                                                                        Price
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
                                                                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                                                <Button onClick={handleManualSave} disabled={saving}>
                                                                    {saving ? 'Saving...' : 'Save'}
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
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
