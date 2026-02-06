import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { calcGlobalFifo } from '@/lib/pnl/calc-m4-m5-2-global-fifo'; // PURE ENGINE
import { toNyCalendarDayString } from '@/lib/ny-time';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { useFirestore } from '@/firebase/index';
import { FifoSnapshot } from '@/lib/types/fifo-snapshot';
import { Loader2 } from 'lucide-react';
import { eachMonthOfInterval, endOfMonth, isFuture } from 'date-fns';

export function SnapshotBackfillButton() {
    const { user, impersonatedUid } = useUser();
    const effectiveUid = impersonatedUid || user?.uid;
    const { data: allTransactions, loading } = useUserTransactions(effectiveUid || null);
    const firestore = useFirestore();

    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState('');

    const handleBackfill = async () => {
        if (!effectiveUid || !allTransactions || allTransactions.length === 0) {
            alert("No transactions or user found.");
            return;
        }
        setProcessing(true);
        setProgress('Preparing...');

        try {
            // 1. Identify Time Range
            // Start from month of first transaction
            const dates = allTransactions.map(t => t.transactionTimestamp);
            const minTs = Math.min(...dates);
            const maxTs = Date.now();

            const startMonth = new Date(minTs);
            const endMonthDate = new Date(); // Now

            const months = eachMonthOfInterval({
                start: startMonth,
                end: endMonthDate
            });

            console.log(`[Backfill] Analyzing range: ${startMonth.toISOString()} -> ${endMonthDate.toISOString()} (${months.length} months)`);

            let snapshotCount = 0;
            const batchSize = 500; // Firestore batch limit

            // 2. Loop through each month END
            for (const monthDate of months) {
                // Get last day of month
                const eom = endOfMonth(monthDate);
                const eomStr = toNyCalendarDayString(eom);

                // If EOM is in future, skip (or use today if it's current month)
                if (isFuture(eom)) {
                    // For current month, we might want to skip saving a snapshot yet?
                    // Or save "Current State"?
                    // User requested "Month End Snapshots".
                    // Let's only save strictly past months for safety, or up to yesterday.
                    continue;
                }

                setProgress(`Processing ${eomStr}...`);

                // 3. Filter Transactions UP TO this date
                // Note: We perform FULL REPLAY for each snapshot to guarantee correctness (O(N^2) but offline is fine)
                // Efficient way: We could incrementalize, but "Pure Engine" calcGlobalFifo is stateless.
                // So we feed it: Txs <= EOM
                // We let it calculate from scratch.

                // Filter: tx.date <= eomStr
                const txsForDate = allTransactions.filter(t => {
                    const d = toNyCalendarDayString(t.transactionTimestamp);
                    return d <= eomStr;
                });

                if (txsForDate.length === 0) continue;

                // 4. Run Calculation
                // No hydration here - we want pure truth from zero
                const result = calcGlobalFifo({
                    transactions: txsForDate,
                    todayNy: eomStr,
                    snapshot: null
                });

                // 5. Build Snapshot Payload
                const snapshotPayload: FifoSnapshot = {
                    date: eomStr,
                    timestamp: eom.getTime(), // Cutoff timestamp? 
                    // Wait, timestamp should be strict. 
                    // Ideally check max timestamp of included txs or just EOD.
                    // Let's use EOD timestamp (UTC millis for 23:59:59 NY?).
                    // Actually, simple: just use the timestamp we filtered by?
                    // No, safe choice: Use the max timestamp of a transaction included, or EOD.
                    // For filtering NEXT run, we want > snapshot.timestamp.
                    // So we must ensure we processed everything <= snapshot.timestamp.
                    // Since we filtered by `d <= eomStr`, we processed everything on that day.
                    // So timestamp = End of that Day.
                    // Approx:
                    version: '1.0',
                    inventory: {}, // Needs transform
                    metrics: {
                        realizedPnl_Lifetime: result.totalRealizedPnl,
                        winCount: result.winCount,
                        lossCount: result.lossCount
                    }
                };

                // Transform Inventory (Map -> Record)
                const inventoryRec: Record<string, any[]> = {};
                for (const [key, lots] of result.openPositions.entries()) {
                    if (lots.length > 0) {
                        inventoryRec[key] = lots;
                    }
                }
                snapshotPayload.inventory = inventoryRec;

                // 6. Save to Firestore
                const docRef = doc(firestore, 'users', effectiveUid, 'snapshots', eomStr);
                await setDoc(docRef, snapshotPayload);
                snapshotCount++;
                console.log(`[Backfill] Saved ${eomStr}: PnL=${result.totalRealizedPnl}, Pos=${Object.keys(inventoryRec).length}`);

                // Tiny Yield
                await new Promise(r => setTimeout(r, 10));
            }

            setProgress(`Done! Saved ${snapshotCount} snapshots.`);
            setTimeout(() => setProcessing(false), 2000);

            // Force reload?
            if (typeof window !== 'undefined') {
                window.location.reload();
            }

        } catch (e: any) {
            console.error(e);
            setProgress(`Error: ${e.message}`);
        }
    };

    if (loading) return null;

    return (
        <Button
            variant="default" // Use primary color
            size="sm"
            onClick={handleBackfill}
            disabled={processing}
            className="bg-purple-600 hover:bg-purple-700 text-white font-mono"
        >
            {processing ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {progress}
                </>
            ) : (
                "⚡️ Backfill History"
            )}
        </Button>
    );
}
