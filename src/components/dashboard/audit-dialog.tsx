
import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHoldings } from "@/hooks/use-holdings";
import { eachDayOfInterval } from "date-fns";
import { toNyCalendarDayString } from "@/lib/ny-time";
import { getOfficialClosesRange } from "@/lib/data/official-close-repo";
import { calcM14DailyCalendar } from "@/lib/pnl/calc-m14-daily-calendar";
import { Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface AuditDialogProps {
    open: boolean;
    onClose: () => void;
}

export function AuditDialog({ open, onClose }: AuditDialogProps) {
    const { allTransactions, activeSplits } = useHoldings();

    const [status, setStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [progress, setProgress] = React.useState("");
    const [jsonResult, setJsonResult] = React.useState("");

    // Auto run on open
    React.useEffect(() => {
        if (open && status === 'idle') {
            runAudit();
        }
    }, [open]);

    const runAudit = async () => {
        setStatus('running');
        setJsonResult("");

        try {
            // 1. Determine Range
            if (!allTransactions || allTransactions.length === 0) {
                setProgress("没有交易记录，无需审计。");
                setStatus('done');
                return;
            }

            const timestamps = allTransactions.map((t: any) => t.transactionTimestamp).filter((ts: number) => ts > 0);
            if (timestamps.length === 0) {
                setProgress("没有有效的交易时间戳。");
                setStatus('done');
                return;
            }
            const minTs = Math.min(...timestamps);

            const startYear = new Date(minTs).getFullYear();
            const endYear = new Date().getFullYear();

            const globalMissingReport: Record<string, string[]> = {};
            let totalMissing = 0;

            for (let year = startYear; year <= endYear; year++) {
                setProgress(`正在扫描 ${year} 年数据...`);

                // Construct dates
                const startOfYear = new Date(Date.UTC(year, 0, 1, 12)); // Noon UTC to avoid TZ issues
                const endOfYear = year === endYear ? new Date() : new Date(Date.UTC(year, 11, 31, 12));

                const days = eachDayOfInterval({ start: startOfYear, end: endOfYear });
                const targetDates = days.map(d => toNyCalendarDayString(d));

                if (targetDates.length === 0) continue;

                const startStr = targetDates[0];
                const endStr = targetDates[targetDates.length - 1];

                const allSyms = Array.from(new Set(allTransactions.map((t: any) => t.symbol).filter(Boolean)));

                const eodMap = await getOfficialClosesRange(startStr, endStr, allSyms);

                // Calc
                const results = calcM14DailyCalendar(allTransactions, targetDates, eodMap, activeSplits);

                // Check
                Object.values(results).forEach(res => {
                    if (res.status === 'missing_data' && res.missingSymbols && res.missingSymbols.length > 0) {
                        res.missingSymbols.forEach(sym => {
                            if (!globalMissingReport[sym]) globalMissingReport[sym] = [];
                            if (!globalMissingReport[sym].includes(res.date)) {
                                globalMissingReport[sym].push(res.date);
                                totalMissing++;
                            }
                        });
                    }
                });
            }

            // Finalize
            Object.keys(globalMissingReport).forEach(sym => {
                globalMissingReport[sym].sort();
                if (globalMissingReport[sym].length === 0) delete globalMissingReport[sym];
            });

            const json = JSON.stringify(globalMissingReport, null, 2);
            setJsonResult(json);
            setProgress(`扫描完成，发现 ${totalMissing} 个缺口。`);
            setStatus('done');

        } catch (e) {
            console.error(e);
            setProgress("审计失败: " + String(e));
            setStatus('error');
        }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(jsonResult);
        toast.success("JSON 已复制到剪贴板");
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl bg-zinc-950 border-zinc-800 text-zinc-100">
                <DialogHeader>
                    <DialogTitle>EOD 数据完整性审计</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                        {status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
                        <span>{progress}</span>
                    </div>

                    {jsonResult && (
                        <div className="relative">
                            <textarea
                                className="w-full h-[400px] bg-zinc-900/50 border border-zinc-700 rounded-md p-3 font-mono text-xs text-emerald-400 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                value={jsonResult}
                                readOnly
                            />
                            <button
                                onClick={copyToClipboard}
                                className="absolute top-2 right-2 p-2 bg-zinc-800 rounded hover:bg-zinc-700 transition-colors border border-zinc-600"
                                title="复制"
                            >
                                <Copy className="h-4 w-4 text-zinc-300" />
                            </button>
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <button
                            onClick={runAudit}
                            disabled={status === 'running'}
                            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 transition-colors"
                        >
                            重新扫描
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
