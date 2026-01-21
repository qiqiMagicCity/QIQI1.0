'use client';

import { useState } from 'react';
import { getOfficialCloses, triggerManualBackfill } from '@/lib/data/official-close-repo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toNyCalendarDayString } from '@/lib/ny-time';
import { initializeFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function BackfillPage() {
    const [logs, setLogs] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);

    // Manual Entry State
    const [manualSymbol, setManualSymbol] = useState('NVDA');
    const [manualDate, setManualDate] = useState('2025-11-24');
    const [manualPrice, setManualPrice] = useState('182.55');
    const [isSaving, setIsSaving] = useState(false);

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, `${new Date().toISOString().split('T')[1]} - ${msg}`]);
    };

    const scanHistory = async () => {
        setIsRunning(true);
        addLog("Scanning history for NVDA (5 years)... [READ ONLY]");

        const symbol = 'NVDA';
        const today = new Date();
        const fiveYearsAgo = new Date();
        fiveYearsAgo.setFullYear(today.getFullYear() - 5);

        let currentDate = fiveYearsAgo;
        const endDate = today;

        let successCount = 0;
        let failCount = 0;
        let missingCount = 0;

        while (currentDate <= endDate) {
            const dateStr = toNyCalendarDayString(currentDate.getTime());

            // Skip weekends
            const dayOfWeek = currentDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }

            try {
                // Read-only check: shouldAutoRequestBackfill = false (Implied now)
                const result = await getOfficialCloses(dateStr, [symbol]);

                const status = result[symbol]?.status;
                if (status === 'ok') {
                    // addLog(`[OK] ${dateStr}: Found data.`);
                    successCount++;
                } else if (status === 'missing') {
                    addLog(`[MISSING] ${dateStr}`);
                    missingCount++;
                } else {
                    addLog(`[${status?.toUpperCase()}] ${dateStr}`);
                }

                // Faster scan since we aren't hitting external API
                await new Promise(resolve => setTimeout(resolve, 10));

            } catch (error: any) {
                addLog(`[ERROR] ${dateStr}: ${error.message}`);
                failCount++;
            }

            currentDate.setDate(currentDate.getDate() + 1);
        }

        addLog(`Scan Finished. Found: ${successCount}, Missing: ${missingCount}, Errors: ${failCount}`);
        setIsRunning(false);
    };

    const handleSmartBackfill = async () => {
        setIsRunning(true);
        addLog("Triggering Manual Backfill (5 Years via Single Request)...");

        try {
            // Calculate most recent past trading day (e.g. yesterday)
            // This ensures we don't hit the "Time Guard" for today
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - 1);

            // Adjust if weekend
            while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
                targetDate.setDate(targetDate.getDate() - 1);
            }

            const dateStr = toNyCalendarDayString(targetDate.getTime());
            addLog(`Targeting Date: ${dateStr}`);

            // Explicitly call manual backfill
            await triggerManualBackfill(dateStr, ['NVDA'], true);

            addLog(`[SUCCESS] Manual Backfill triggered for ${dateStr}. Backend is now fetching data.`);
            addLog("Please wait ~30 seconds then click 'Scan History' to verify.");

        } catch (e: any) {
            addLog(`[ERROR] Smart Backfill failed: ${e.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    const handleManualSave = async () => {
        setIsSaving(true);
        addLog(`Saving manual EOD: ${manualSymbol} on ${manualDate} @ ${manualPrice}`);
        try {
            const { firestore } = initializeFirebase();
            const eodId = `${manualDate}_${manualSymbol}`;
            const docRef = doc(firestore, 'officialCloses', eodId);

            await setDoc(docRef, {
                symbol: manualSymbol,
                date: manualDate,
                tradingDate: manualDate,
                close: parseFloat(manualPrice),
                status: 'ok',
                provider: 'manual_entry_ui',
                updatedAt: new Date()
            }, { merge: true });

            addLog(`[SUCCESS] Saved ${eodId}`);
        } catch (e: any) {
            addLog(`[ERROR] Save failed: ${e.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="p-8 space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Manual EOD Entry</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Symbol</Label>
                            <Input value={manualSymbol} onChange={e => setManualSymbol(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Date (YYYY-MM-DD)</Label>
                            <Input value={manualDate} onChange={e => setManualDate(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Close Price</Label>
                            <Input value={manualPrice} onChange={e => setManualPrice(e.target.value)} />
                        </div>
                    </div>
                    <Button onClick={handleManualSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Manual EOD'}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>NVDA Backfill Tool (5 Years)</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 mb-4">
                        <Button onClick={handleSmartBackfill} disabled={isRunning} className="bg-purple-600 hover:bg-purple-700">
                            {isRunning ? 'Running...' : 'Smart Backfill (5 Years)'}
                        </Button>
                        <Button onClick={scanHistory} disabled={isRunning} variant="outline">
                            {isRunning ? 'Scanning...' : 'Scan History (Read-Only)'}
                        </Button>
                    </div>

                    <div className="mt-4 h-[500px] overflow-y-auto bg-slate-950 text-slate-50 p-4 rounded font-mono text-xs">
                        {logs.map((log, i) => (
                            <div key={i}>{log}</div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
