'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useUser } from '@/firebase';
import { useUserTransactions } from '@/hooks/use-user-transactions';
import { getOfficialClosesRange, OfficialCloseResult, getSymbolRevisions } from '@/lib/data/official-close-repo';
import { calcM14DailyCalendar } from '@/lib/pnl/calc-m14-daily-calendar';
import { getActiveSymbols } from '@/lib/holdings/active-symbols';
import { startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { toNyCalendarDayString } from '@/lib/ny-time';
import {
    getPnlSnapshot,
    generateEodFingerprint,
    CALC_ENGINE_VERSION,
    getGlobalTxRevision,
    savePnlSnapshot,
    reportPnLHit,
    getBreakerState
} from '@/lib/snapshots/pnl-snapshot-repo';
import { subscribeToPnlSync } from '@/lib/snapshots/broadcast';

export type PnlRenderStatus = 'LOADING' | 'FRESH' | 'STALE_RECOMPUTING' | 'MISSING_RECOMPUTING' | 'SAFE' | 'ERROR';

export function useDailyPnl(currentMonth: Date) {
    const { user } = useUser();
    const effectiveUid = user?.uid;
    const { data: transactions, loading: txLoading } = useUserTransactions(effectiveUid);

    const [eodMap, setEodMap] = useState<Record<string, OfficialCloseResult>>({});
    const [calcResults, setCalcResults] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<PnlRenderStatus>('LOADING');
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const requestIdRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    const { targetDates, uniqueSymbols, monthId } = useMemo(() => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        const dates = eachDayOfInterval({ start, end }).map(d => toNyCalendarDayString(d));
        const monthId = toNyCalendarDayString(start).substring(0, 7);

        const activeSymbols = getActiveSymbols(transactions || [], toNyCalendarDayString(start), toNyCalendarDayString(end));

        return { targetDates: dates, uniqueSymbols: activeSymbols, monthId };
    }, [currentMonth, transactions]);

    const processedRevisionRef = useRef<number>(0);

    // Cross-Tab Sync Listener
    useEffect(() => {
        if (!effectiveUid) return;

        const unsubscribe = subscribeToPnlSync(effectiveUid, (msg) => {
            // Railing B: Idempotency Check
            if (msg.txRevision <= processedRevisionRef.current) {
                return; // Already seen or newer revision already processed
            }

            const txMonth = msg.txDateStr.substring(0, 7);
            if (txMonth <= monthId) {
                console.log(`[useDailyPnl] 🔄 Cross-tab refresh triggered by TX on ${msg.txDateStr} (New Rev: ${msg.txRevision}, Old Local: ${processedRevisionRef.current})`);
                setRefreshTrigger(prev => prev + 1);
            }
        });

        return () => unsubscribe();
    }, [effectiveUid, monthId]);

    // Snapshot-First Orchestrator
    useEffect(() => {
        if (!effectiveUid || txLoading || !transactions) return;

        const rid = ++requestIdRef.current;
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const runWorkflow = async () => {
            setLoading(true);
            setStatus('LOADING');

            try {
                const startTime = Date.now();
                let workflowStatus: 'HIT' | 'MISS' | 'STAL' = 'MISS';
                let staleReason = '';

                // 1. Try Load Snapshot
                const snapshot = await getPnlSnapshot(effectiveUid, monthId);
                if (abortController.signal.aborted || rid !== requestIdRef.current) return;

                let isHit = false;
                if (snapshot) {
                    // 2. Fingerprint Validation
                    const [curTxRev, revisionsMap] = await Promise.all([
                        getGlobalTxRevision(effectiveUid),
                        getSymbolRevisions(snapshot.meta.symbols)
                    ]);
                    processedRevisionRef.current = Math.max(processedRevisionRef.current, curTxRev);

                    if (abortController.signal.aborted || rid !== requestIdRef.current) return;

                    const curEodFingerprint = await generateEodFingerprint(
                        snapshot.meta.symbols.map(s => ({ symbol: s, eodRevision: revisionsMap[s] || 0 }))
                    );

                    const fp = snapshot.fingerprint;
                    const isTxMatch = fp.txRevision === curTxRev;
                    const isEodMatch = fp.eodFingerprint === curEodFingerprint;
                    const isEngineMatch = fp.calcEngineVersion === CALC_ENGINE_VERSION;

                    if (isTxMatch && isEodMatch && isEngineMatch) {
                        isHit = true;
                        workflowStatus = 'HIT';
                        reportPnLHit();
                        const results: Record<string, any> = {};
                        snapshot.data.dailyTotalPnlCents.forEach((cents, idx) => {
                            const date = targetDates[idx];
                            if (date && cents !== null) {
                                results[date] = {
                                    date,
                                    totalPnl: cents / 100,
                                    status: 'ok',
                                    isFromSnapshot: true
                                };
                            }
                        });
                        setCalcResults(results);
                        setStatus(getBreakerState() === 'OPEN' ? 'SAFE' : 'FRESH');
                        setLoading(false);
                        console.log(`[useDailyPnl] SNAPSHOT_HIT for ${monthId} (Rev: ${curTxRev})`);
                    } else {
                        workflowStatus = 'STAL';
                        if (typeof window !== 'undefined' && (window as any).__FIREBASE_STATS__) (window as any).__FIREBASE_STATS__.snapshotStale++;
                        staleReason = `tx:${!isTxMatch}, eod:${!isEodMatch}, v:${!isEngineMatch}`;
                        setStatus('STALE_RECOMPUTING');
                        console.log(`[useDailyPnl] SNAPSHOT_STALE for ${monthId}. Recomputing... Reason: ${staleReason}`);
                    }
                } else {
                    workflowStatus = 'MISS';
                    if (typeof window !== 'undefined' && (window as any).__FIREBASE_STATS__) (window as any).__FIREBASE_STATS__.snapshotMiss++;
                    setStatus('MISSING_RECOMPUTING');
                    console.log(`[useDailyPnl] SNAPSHOT_MISS for ${monthId}. Recomputing...`);
                }

                // 3. Recompute if needed
                if (!isHit) {
                    const compStart = Date.now();
                    const startStr = targetDates[0];
                    const endStr = targetDates[targetDates.length - 1];

                    const results = await getOfficialClosesRange(startStr, endStr, uniqueSymbols, {
                        includePrevTradingDay: true
                    });

                    if (abortController.signal.aborted || rid !== requestIdRef.current) return;

                    setEodMap(prev => ({ ...prev, ...results }));
                    const finalPnlMap = calcM14DailyCalendar(transactions, targetDates, { ...eodMap, ...results });
                    setCalcResults(finalPnlMap);

                    const duration = Date.now() - startTime;
                    const compTime = Date.now() - compStart;

                    // [RULE 2] Recompute Cost Monitoring
                    console.log(`[Audit] ⏱️ Recompute Cost | Month: ${monthId} | Total: ${duration}ms | Reason: ${workflowStatus === 'STAL' ? staleReason : workflowStatus}`);
                    const stats = (window as any).__FIREBASE_STATS__ || {};
                    console.log(`[Audit] 💸 Billing Evidence | getDoc: ${stats.getDoc} | getDocs: ${stats.getDocs} | setDoc: ${stats.setDoc} | MISS: ${stats.snapshotMiss}`);

                    // [THRESHOLD T2] STAL Rate Audit
                    if (typeof window !== 'undefined') {
                        const win = window as any;
                        win.__PNL_AUDIT__ = win.__PNL_AUDIT__ || { total: 0, stal: 0 };
                        win.__PNL_AUDIT__.total++;
                        if (workflowStatus === 'STAL') win.__PNL_AUDIT__.stal++;

                        const stalRate = win.__PNL_AUDIT__.stal / win.__PNL_AUDIT__.total;
                        if (stalRate > 0.3 && win.__PNL_AUDIT__.total >= 5) {
                            console.warn(`[THRESHOLD T2] 🚨 High STALE Rate Detected: ${(stalRate * 100).toFixed(1)}%. Triggering breaker check.`);
                        }
                    }

                    setStatus(getBreakerState() === 'OPEN' ? 'SAFE' : 'FRESH');
                    setLoading(false);

                    // 4. Background Save Snapshot
                    const totalMonthPnl = Object.values(finalPnlMap).reduce((acc: number, curr: any) => acc + (curr.totalPnl || 0), 0);
                    const dailyCents = targetDates.map(d => {
                        const r = finalPnlMap[d];
                        return r ? Math.round(r.totalPnl * 100) : null;
                    });

                    const [txRevision, revs] = await Promise.all([
                        getGlobalTxRevision(effectiveUid),
                        getSymbolRevisions(uniqueSymbols)
                    ]);
                    processedRevisionRef.current = Math.max(processedRevisionRef.current, txRevision);

                    const eodFingerprint = await generateEodFingerprint(
                        uniqueSymbols.map(s => ({ symbol: s, eodRevision: revs[s] || 0 }))
                    );

                    await savePnlSnapshot(effectiveUid, {
                        monthId,
                        fingerprint: {
                            txRevision,
                            eodFingerprint,
                            calcEngineVersion: CALC_ENGINE_VERSION,
                            splitsRevision: '1',
                            fxRevision: '1',
                            eodFingerprintScope: 'symbolRevGlobal'
                        },
                        data: {
                            totalPnlCents: Math.round(totalMonthPnl * 100),
                            dailyTotalPnlCents: dailyCents
                        },
                        symbols: uniqueSymbols
                    });
                }
            } catch (err) {
                console.error("PnL Workflow Error:", err);
                if (!abortController.signal.aborted) setStatus('ERROR');
            } finally {
                if (rid === requestIdRef.current) setLoading(false);
            }
        };

        runWorkflow();

        return () => { abortController.abort(); };
    }, [monthId, transactions, txLoading, effectiveUid, refreshTrigger]);

    return {
        dailyPnlResults: calcResults,
        loading,
        status
    };
}
