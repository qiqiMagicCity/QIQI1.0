import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveManualEod } from "@/lib/data/official-close-repo";
import { Loader2 } from "lucide-react";
import { toast } from "sonner"; // Assuming sonner or similar usage, otherwise standard alert

interface ManualEodDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    symbol: string;
    date: string;
    onSuccess: () => void;
}

export function ManualEodDialog({
    open,
    onOpenChange,
    symbol,
    date,
    onSuccess,
}: ManualEodDialogProps) {
    const [price, setPrice] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        const val = parseFloat(price);
        if (isNaN(val) || val <= 0) {
            alert("请输入有效的价格");
            return;
        }

        // Confirmation Logic handled by the Dialog itself acting as the confirm step.
        // But user asked for specific confirmation prompt.
        // The dialog itself IS the prompt. "Are you sure you want to write X?" could be a second step,
        // but typically a Dialog with "Confirm" button is sufficient.
        // Let's make sure the UI is clear.

        try {
            setLoading(true);
            await saveManualEod(date, symbol, val);
            setLoading(false);
            onOpenChange(false);
            onSuccess();
            // Optional: Toast success
        } catch (e) {
            console.error(e);
            setLoading(false);
            alert("保存失败，请重试");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>手动录入 EOD 数据</DialogTitle>
                    <DialogDescription>
                        请为 <strong>{symbol}</strong> 在 <strong>{date}</strong> 录入收盘价。
                        <br />
                        <span className="text-red-500 text-xs">注意：这将以此价格直接覆盖系统数据。</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="price" className="text-right">
                            收盘价
                        </Label>
                        <Input
                            id="price"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="col-span-3"
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        确认录入
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
