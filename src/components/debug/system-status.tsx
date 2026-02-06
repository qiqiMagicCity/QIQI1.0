
"use client";

import React, { useEffect, useState } from 'react';
import { useHoldingsContext } from '@/contexts/holdings-provider';
import { Badge } from '@/components/ui/badge';
import { Activity, Database, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SystemStatus() {
    const {
        loading,
        dailyPnlResults, // If empty, calc might not be done
        snapshotLoaded,
        snapshotDate,
        rows
    } = useHoldingsContext() as any; // Cast because snapshot props might be new in context

    // [NEW] Consumption of Auto Heal
    const autoHealProgress = (useHoldingsContext() as any).autoHealProgress;

    // Derive status
    const hasResults = Object.keys(dailyPnlResults || {}).length > 0;
    const hasRows = rows && rows.length > 0;

    // Checking for NaN anomalies (Integrity Check)
    const integrityError = rows ? rows.some((r: any) =>
        (typeof r.pnl === 'number' && isNaN(r.pnl)) ||
        (typeof r.mv === 'number' && isNaN(r.mv))
    ) : false;

    let status: 'healthy' | 'loading' | 'error' | 'warmup' | 'syncing' = 'warmup';
    let message = '初始化中...';

    if (autoHealProgress) {
        status = 'syncing';
        // [FIX] Show detailed status message from provider (e.g. "Requesting 2024-xx... (50 symbols)")
        message = autoHealProgress.status || `云端同步中 (${autoHealProgress.current})`;
    } else if (loading) {
        status = 'loading';
        message = '计算中...';
    } else if (integrityError) {
        status = 'error';
        message = '数据异常 (NaN)';
    } else if (hasResults) {
        // Calc done
        if (snapshotLoaded) {
            status = 'healthy';
            message = `快照激活 (${snapshotDate})`;
        } else {
            status = 'healthy'; // Still healthy, just full calc
            message = '全量计算 (无快照)';
        }
    } else {
        // No results yet, maybe just started or empty
        if (hasRows) {
            status = 'loading'; // Rows exist but PnL not ready?
        } else {
            status = 'warmup'; // Empty state
            message = '无数据';
        }
    }

    // Color logic
    const colors = {
        healthy: "bg-emerald-500/10 text-emerald-600 border-emerald-200 hover:bg-emerald-500/20",
        loading: "bg-blue-500/10 text-blue-600 border-blue-200",
        error: "bg-red-500/10 text-red-600 border-red-200 animate-pulse",
        warmup: "bg-slate-500/10 text-slate-600 border-slate-200",
        syncing: "bg-amber-500/10 text-amber-600 border-amber-200" // [NEW] Sync Color
    };

    const icons = {
        healthy: <CheckCircle2 className="w-3.5 h-3.5" />,
        loading: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        error: <AlertCircle className="w-3.5 h-3.5" />,
        warmup: <Activity className="w-3.5 h-3.5" />,
        syncing: <Loader2 className="w-3.5 h-3.5 animate-spin" /> // Reuse loader or cloud download
    };

    // Internal visual state (delayed healthy to avoid flicker)
    const isSnapshotMode = message.includes('快照');

    return (
        <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all duration-300",
            status === 'healthy' && isSnapshotMode ? "bg-purple-500/10 text-purple-600 border-purple-200" : colors[status]
        )}>
            {status === 'healthy' && isSnapshotMode ? <Database className="w-3.5 h-3.5" /> : icons[status]}
            <span className="hidden sm:inline">
                {status === 'healthy' ? (isSnapshotMode ? '极速模式' : '系统就绪') : message}
            </span>
        </div>
    );
}
