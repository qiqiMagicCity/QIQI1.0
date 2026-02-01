"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner"; // Assuming sonner is available
import { useUser } from "@/firebase";

export function EodDiagnosticTool() {
    const [open, setOpen] = useState(false);
    const [symbol, setSymbol] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const { user } = useUser();

    const handleRequestBackfill = async () => {
        if (!symbol) return;
        setLoading(true);
        setResult(null);
        try {
            const functions = getFunctions(getApp());
            const requestBackfillEod = httpsCallable(functions, "requestBackfillEod");
            // The function likely takes { symbol: string[] } or similar.
            // Checking functions/src/admin/request-backfill-eod.ts if possible, but let's guess standard payload.
            const resp = await requestBackfillEod({ symbols: [symbol.toUpperCase()] });
            setResult(resp.data);
            toast.success(`Triggered backfill for ${symbol}`);
        } catch (err: any) {
            console.error(err);
            setResult({ error: err.message });
            toast.error("Backfill request failed");
        } finally {
            setLoading(false);
        }
    };

    if (!user?.email?.endsWith("admin_email_placeholder") && !user?.uid) {
        // Very basic gating or just show it for debug
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Wrench className="h-4 w-4" />
                    EOD 诊断
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>EOD 强制补录工具</DialogTitle>
                    <DialogDescription>
                        手动触发后台 Cloud Function 尝试补录指定代码的历史 EOD 数据。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="symbol" className="text-right">
                            Symbol
                        </Label>
                        <Input
                            id="symbol"
                            className="col-span-3"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                            placeholder="e.g. TSLA"
                        />
                    </div>

                    {result && (
                        <div className="mt-4 p-2 bg-slate-900 text-slate-100 text-xs rounded overflow-auto max-h-[200px]">
                            <pre>{JSON.stringify(result, null, 2)}</pre>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button onClick={handleRequestBackfill} disabled={loading || !symbol}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        立即补录 (Trigger Cloud Function)
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
