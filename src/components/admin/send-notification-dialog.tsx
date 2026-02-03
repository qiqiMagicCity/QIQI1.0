import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useNotifications } from "@/hooks/use-notifications";
import { BellRing, Loader2 } from "lucide-react";

interface AdminNotificationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AdminNotificationDialog({ open, onOpenChange }: AdminNotificationDialogProps) {
    const { sendNotification } = useNotifications();
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [type, setType] = useState<'info' | 'success' | 'warning' | 'error'>("info");
    const [sending, setSending] = useState(false);

    const handleSend = async () => {
        if (!title.trim() || !message.trim()) return;

        setSending(true);
        try {
            await sendNotification(title, message, type);
            onOpenChange(false);
            // Reset form
            setTitle("");
            setMessage("");
            setType("info");
        } catch (error) {
            console.error("Failed to send notification", error);
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BellRing className="w-5 h-5 text-primary" />
                        发送全站通知 (仅管理员)
                    </DialogTitle>
                    <DialogDescription>
                        这条消息将推送给所有在线用户。请谨慎使用。
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="title" className="text-right">标题</Label>
                        <Input
                            id="title"
                            className="col-span-3"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="例如：系统维护通知"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor="message" className="text-right mt-2">内容</Label>
                        <Textarea
                            id="message"
                            className="col-span-3 min-h-[100px]"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="请输入通知详细内容..."
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type" className="text-right">类型</Label>
                        <Select value={type} onValueChange={(v: any) => setType(v)}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="选择通知等级" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="info">Info (普通)</SelectItem>
                                <SelectItem value="success">Success (成功)</SelectItem>
                                <SelectItem value="warning">Warning (警告)</SelectItem>
                                <SelectItem value="error">Error (紧急)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
                        取消
                    </Button>
                    <Button onClick={handleSend} disabled={sending || !title || !message}>
                        {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        发送广播
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
