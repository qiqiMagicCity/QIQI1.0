"use client";

import { useEffect, useState } from "react";
import { Bell, CheckCheck, Trash2, Megaphone, Info, AlertTriangle, AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, SystemNotification } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useUser } from "@/firebase";
import { AdminNotificationDialog } from "@/components/admin/send-notification-dialog";
import { cn } from "@/lib/utils";

export function NotificationBell() {
    const { notifications, unreadCount, markAllAsRead, deleteNotification } = useNotifications();
    const { isAdmin } = useUser();
    const [isOpen, setIsOpen] = useState(false);
    const [showAdminDialog, setShowAdminDialog] = useState(false);

    // Auto mark as read when opening? Or manual?
    // Let's keep manual "Mark all as read" or auto when opening.
    // Standard UX is auto-clear badge when opening, but keep items as "new" specifically?
    // Let's rely on the explicit "lastReadTime".
    // When user opens popover, we can just let them see the content.
    // If they click "Mark Read", we clear badge.

    // Better UX: clicking the bell clears the badge implicitly? 
    // Let's add a button "Mark Read".

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'success': return <CheckCheck className="h-4 w-4 text-green-500" />;
            case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
            case 'error': return <AlertCircle className="h-4 w-4 text-red-500" />;
            default: return <Info className="h-4 w-4 text-blue-500" />;
        }
    }

    const formatDate = (date: any) => {
        if (!date) return '';
        const d = date.toMillis ? date.toDate() : new Date(date);
        return formatDistanceToNow(d, { addSuffix: true, locale: zhCN });
    }

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (open && unreadCount > 0) {
            // Optional: Auto mark read on open? 
            // markAllAsRead(); 
        }
    };

    return (
        <>
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full relative">
                        <Bell className="h-5 w-5" />
                        <span className="sr-only">通知</span>
                        {unreadCount > 0 && (
                            <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[380px] p-0" align="end">
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                        <h4 className="font-semibold text-sm">通知中心</h4>
                        {unreadCount > 0 ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-auto px-2 text-xs text-muted-foreground hover:text-primary"
                                onClick={markAllAsRead}
                            >
                                <CheckCheck className="w-3 h-3 mr-1" />
                                全部已读
                            </Button>
                        ) : (
                            <span className="text-xs text-muted-foreground">暂无新消息</span>
                        )}
                    </div>
                    <ScrollArea className="h-[300px]">
                        <div className="flex flex-col">
                            {notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                                    <Bell className="h-8 w-8 mb-2 opacity-20" />
                                    <p className="text-sm">没有收到任何通知</p>
                                </div>
                            ) : (
                                notifications.map((item) => (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "flex items-start gap-4 p-4 border-b last:border-0 hover:bg-muted/50 transition-colors relative group",
                                            // Highlight logic if we stored per-item read state? 
                                            // For now just flat list.
                                        )}
                                    >
                                        <div className="mt-1">
                                            {getTypeIcon(item.type)}
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <p className="text-sm font-medium leading-none flex justify-between">
                                                {item.title}
                                                <span className="text-xs text-muted-foreground font-normal ml-2">
                                                    {formatDate(item.createdAt)}
                                                </span>
                                            </p>
                                            <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
                                                {item.message}
                                            </p>
                                        </div>
                                        {isAdmin && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteNotification(item.id);
                                                }}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                    {isAdmin && (
                        <div className="p-2 border-t bg-muted/30">
                            <Button
                                variant="outline"
                                className="w-full h-8 text-xs border-dashed border-primary/50 text-primary"
                                onClick={() => {
                                    setIsOpen(false);
                                    setShowAdminDialog(true);
                                }}
                            >
                                <Megaphone className="w-3 h-3 mr-2" />
                                发送全站广播 (Admin)
                            </Button>
                        </div>
                    )}
                </PopoverContent>
            </Popover>

            <AdminNotificationDialog
                open={showAdminDialog}
                onOpenChange={setShowAdminDialog}
            />
        </>
    );
}
