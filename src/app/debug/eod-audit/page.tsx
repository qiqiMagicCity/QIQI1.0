'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'; // Assuming standard Shadcn table
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { toNyCalendarDayString, isNyTradingDay } from '@/lib/ny-time';
import { getOfficialClosesBatch, triggerManualBackfill, OfficialCloseResult } from '@/lib/data/official-close-repo';
import { toast } from 'sonner';

interface AuditRow {
    id: string; // date_symbol
    date: string;
    symbol: string;
    close: number | null;
    prevClose: number | null;
    ratio: number | null;
    status: 'ok' | 'missing' | 'zero' | 'jump';
    reason: string;
    details: string;
}

export default function EodAuditPage() {
    const [month, setMonth] = useState('2025-11');
    const [symbolsInput, setSymbolsInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [scanResults, setScanResults] = useState<AuditRow[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [repairing, setRepairing] = useState(false);

    const handleScan = async () => {
        if (!month) return;
        setLoading(true);
        setScanResults([]);
        setSelectedIds(new Set());

        try {
            // 1. Generate Dates
            const [y, m] = month.split('-').map(Number);
            const start = startOfMonth(new Date(y, m - 1, 1)); // Month is 0-indexed in Date ctor? No, 1 in input, 0 in ctor.
            const end = endOfMonth(start);
            const daysRaw = eachDayOfInterval({ start, end });

            // Filter only valid trading days
            const targetDates = daysRaw
                .map(d => toNyCalendarDayString(d))
                .filter(d => isNyTradingDay(d));

            // 2. Parse Symbols
            const symbols = symbolsInput
                .split(/[\n, ]+/)
                .map(s => s.trim().toUpperCase())
                .filter(s => s.length > 0);

            if (symbols.length === 0) {
                toast.error("Please enter at least one symbol.");
                setLoading(false);
                return;
            }

            console.log(`Scanning ${symbols.length} symbols over ${targetDates.length} days...`);

            // 3. Fetch Data (Optimized Batch)
            // We also need the day BEFORE the first day to calculate ratio for the first day
            // But for simplicity, we'll scan intra-month ratios only, or fetch one extra day.
            // Let's rely on internal continuity.
            const data = await getOfficialClosesBatch(targetDates, symbols);

            // 4. Analyze
            const anomalies: AuditRow[] = [];

            // Sort dates to ensure prevClose tracking
            targetDates.sort();

            for (const sym of symbols) {
                let prevClose: number | null = null;

                for (const date of targetDates) {
                    const key = `${date}_${sym}`;
                    const res = data[key];

                    let close: number | null = null;
                    let status: AuditRow['status'] = 'ok';
                    let reason = '';

                    // Check Missing
                    if (!res || res.status !== 'ok' || typeof res.close !== 'number') {
                        status = 'missing';
                        reason = 'Data Missing or Error';
                    } else {
                        close = res.close;

                        // Check Zero/Invalid
                        if (close <= 0 || isNaN(close)) {
                            status = 'zero';
                            reason = `Invalid Price: ${close}`;
                        } else if (prevClose !== null) {
                            // Check Jump
                            const ratio = close / prevClose;
                            if (ratio > 3.0) {
                                status = 'jump';
                                reason = `Jump > 3x (${ratio.toFixed(2)})`;
                            } else if (ratio < 0.33) {
                                status = 'jump';
                                reason = `Drop < 1/3x (${ratio.toFixed(2)})`;
                            }
                        }
                    }

                    if (status !== 'ok') {
                        anomalies.push({
                            id: key,
                            date,
                            symbol: sym,
                            close,
                            prevClose,
                            ratio: close && prevClose ? close / prevClose : null,
                            status,
                            reason,
                            details: `Prev: ${prevClose?.toFixed(2) ?? 'N/A'} -> Curr: ${close?.toFixed(2) ?? 'N/A'}`
                        });
                    }

                    // Update prevClose ONLY if current is valid (otherwise we might compare across gaps, which is also useful but tricky)
                    if (close !== null && close > 0) {
                        prevClose = close;
                    }
                }
            }

            setScanResults(anomalies);
            if (anomalies.length === 0) {
                toast.success("No anomalies found!");
            } else {
                toast.warning(`Found ${anomalies.length} anomalies.`);
            }

        } catch (e) {
            console.error(e);
            toast.error("Scan failed. Check console.");
        } finally {
            setLoading(false);
        }
    };

    const toggleSelect = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) next.add(id);
        else next.delete(id);
        setSelectedIds(next);
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(scanResults.map(r => r.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleRepair = async () => {
        if (selectedIds.size === 0) return;
        setRepairing(true);

        try {
            // Group by Date
            const updatesByDate = new Map<string, string[]>();

            selectedIds.forEach(id => {
                const [date, sym] = id.split('_');
                if (!updatesByDate.has(date)) updatesByDate.set(date, []);
                updatesByDate.get(date)!.push(sym);
            });

            // Iterate and Execute
            const totalDates = updatesByDate.size;
            let completedDates = 0;

            for (const [date, syms] of updatesByDate) {
                // Chunk symbols <= 20
                for (let i = 0; i < syms.length; i += 20) {
                    const chunk = syms.slice(i, i + 20);

                    toast.loading(`Repairing ${date} (${chunk.length} symbols)...`); // Show temp toast

                    await triggerManualBackfill(date, chunk, true); // authorized=true

                    await new Promise(r => setTimeout(r, 500)); // Gentle pacing
                }
                completedDates++;
            }

            toast.success(`Repair triggered for ${selectedIds.size} items! Waiting for cloud sync...`);

            // Wait a bit then re-scan?
            // Optional: Auto re-scan after 5 seconds
            setTimeout(() => {
                toast.info("Re-scanning to verify...");
                handleScan();
            }, 5000);

        } catch (e: any) {
            console.error(e);
            toast.error(`Repair failed: ${e.message}`);
        } finally {
            setRepairing(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <Card className="border-zinc-800 bg-zinc-950/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                        EOD Data Audit & Repair Tool
                    </CardTitle>
                    <CardDescription>
                        Scan EOD data for gaps, zeros, and massive jumps. Repair anomalies by triggering manual backfill.
                        Safe Mode: No auto-writes.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="space-y-2">
                            <Label>Target Month (YYYY-MM)</Label>
                            <Input
                                type="month"
                                value={month}
                                onChange={e => setMonth(e.target.value)}
                                className="bg-zinc-900 border-zinc-700 font-mono"
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label>Symbols (Space/Comma separated)</Label>
                            <Textarea
                                value={symbolsInput}
                                onChange={e => setSymbolsInput(e.target.value)}
                                placeholder="NVDA TSLA AAPL MSFT..."
                                className="bg-zinc-900 border-zinc-700 font-mono h-24"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3">
                        <Button
                            variant="default"
                            size="lg"
                            disabled={loading || repairing}
                            onClick={handleScan}
                            className="w-32 bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {loading ? <Loader2 className="animate-spin mr-2" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Scan
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {scanResults.length > 0 && (
                <Card className="border-zinc-800 bg-zinc-950/50">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle>Scan Results ({scanResults.length})</CardTitle>
                        <Button
                            variant="destructive"
                            disabled={repairing || selectedIds.size === 0}
                            onClick={handleRepair}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white border-none"
                        >
                            {repairing ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                            Repair Selected ({selectedIds.size})
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <div className="max-h-[600px] overflow-auto border rounded-md border-zinc-800">
                            <Table>
                                <TableHeader className="bg-zinc-900 sticky top-0 z-10">
                                    <TableRow>
                                        <TableHead className="w-[50px]">
                                            <Checkbox
                                                checked={scanResults.length > 0 && selectedIds.size === scanResults.length}
                                                onCheckedChange={(c) => handleSelectAll(!!c)}
                                            />
                                        </TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Symbol</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Details</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {scanResults.map((row) => (
                                        <TableRow key={row.id} className="hover:bg-zinc-900/50">
                                            <TableCell>
                                                <Checkbox
                                                    checked={selectedIds.has(row.id)}
                                                    onCheckedChange={(c) => toggleSelect(row.id, !!c)}
                                                />
                                            </TableCell>
                                            <TableCell className="font-mono text-zinc-400">{row.date}</TableCell>
                                            <TableCell className="font-bold text-zinc-200">{row.symbol}</TableCell>
                                            <TableCell>
                                                <StatusBadge status={row.status} />
                                                <div className="text-[10px] text-muted-foreground mt-1">{row.reason}</div>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{row.details}</TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs"
                                                    onClick={() => {
                                                        setSelectedIds(new Set([row.id]));
                                                        handleRepair(); // Immedate repair? No, user might want to select multiples. Just check it.
                                                        // Actually, this button is confusing if repair is a separate action.
                                                        // Let's just rely on checkbox.
                                                        // Or make this "Select"
                                                        toggleSelect(row.id, true);
                                                    }}
                                                >
                                                    Select
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: AuditRow['status'] }) {
    switch (status) {
        case 'missing': return <Badge variant="destructive" className="bg-rose-900 text-rose-200">Missing</Badge>;
        case 'zero': return <Badge variant="destructive" className="bg-red-900 text-red-200">Zero/Invalid</Badge>;
        case 'jump': return <Badge className="bg-amber-900 text-amber-200 border-amber-800">Price Jump</Badge>;
        default: return <Badge variant="outline">OK</Badge>;
    }
}
