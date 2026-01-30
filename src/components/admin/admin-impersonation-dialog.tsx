'use client';

import React, { useState, useEffect } from 'react';
import { useUser, useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { UserCog, Users, RefreshCw, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AdminUser {
    uid: string;
    email?: string;
    displayName?: string;
    lastSignInTime?: string;
}

interface AdminImpersonationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AdminImpersonationDialog({ open, onOpenChange }: AdminImpersonationDialogProps) {
    const { isAdmin, impersonateUser, impersonatedUid } = useUser();
    const auth = useAuth();

    const [targetUid, setTargetUid] = useState('');
    const [userList, setUserList] = useState<AdminUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const fetchUsers = async () => {
        if (userList.length > 0) return;
        setLoadingUsers(true);
        setFetchError(null);
        try {
            const realUser = auth?.currentUser;
            if (!realUser) throw new Error("No admin user found");

            const token = await realUser.getIdToken();
            const res = await fetch('/api/admin/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Fetch failed');
            setUserList(data.users || []);
        } catch (e: any) {
            console.error("Failed to fetch users", e);
            setFetchError(e.message);
        } finally {
            setLoadingUsers(false);
        }
    };

    useEffect(() => {
        if (open && isAdmin) {
            fetchUsers();
        }
    }, [open, isAdmin]);

    const handleSwitch = (uid: string) => {
        if (!uid) return;
        impersonateUser(uid.trim());
        onOpenChange(false);
    };

    const handleReset = () => {
        impersonateUser(null);
        setTargetUid('');
        onOpenChange(false);
    };

    const filteredUsers = userList.filter(u =>
        (u.email || '').toLowerCase().includes(targetUid.toLowerCase()) ||
        u.uid.includes(targetUid)
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-red-600" />
                        管理员上帝模式
                    </DialogTitle>
                    <DialogDescription>
                        您可以切换到任意用户的视角进行调试。
                        <br />当前管理员: <span className="font-mono text-xs">{auth?.currentUser?.email}</span>
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-2">
                    {impersonatedUid && (
                        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-md flex items-center gap-3 border border-red-200 dark:border-red-800">
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                            <div className="text-sm">
                                <div className="font-bold text-red-600">正在模拟用户</div>
                                <div className="font-mono text-xs text-muted-foreground">{impersonatedUid}</div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Input
                            placeholder="搜索用户 (UID 或 邮箱)..."
                            value={targetUid}
                            onChange={(e) => setTargetUid(e.target.value)}
                            className="col-span-3"
                        />
                    </div>

                    <ScrollArea className="h-[200px] w-full rounded-md border p-2 bg-muted/40">
                        {loadingUsers ? (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                                <Loader2 className="animate-spin h-5 w-5" />
                                <span className="text-xs">加载用户列表...</span>
                            </div>
                        ) : fetchError ? (
                            <div className="p-2 text-red-500 text-xs text-center">
                                <div>无法加载用户列表</div>
                                <div className="opacity-70 mt-1">{fetchError}</div>
                                <div className="mt-2 text-[10px] text-muted-foreground">请手动输入 UID</div>
                            </div>
                        ) : filteredUsers.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                                {targetUid ? '没有找到匹配的用户' : '没有用户数据'}
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {filteredUsers.map(u => (
                                    <div
                                        key={u.uid}
                                        onClick={() => setTargetUid(u.uid)}
                                        className={`p-2 rounded cursor-pointer flex flex-col hover:bg-accent transition-colors ${targetUid === u.uid ? "bg-accent ring-1 ring-primary/50" : ""}`}
                                    >
                                        <div className="font-medium text-sm truncate">{u.email || '无邮箱'}</div>
                                        <div className="text-[10px] text-muted-foreground font-mono truncate">{u.uid}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                <DialogFooter className="flex gap-2 sm:justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleReset}
                        disabled={!impersonatedUid}
                        className="gap-2"
                    >
                        <RefreshCw className="h-4 w-4" />
                        还原身份
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={() => handleSwitch(targetUid)}
                        disabled={!targetUid}
                        className="gap-2"
                    >
                        <UserCog className="h-4 w-4" />
                        切换视角
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
