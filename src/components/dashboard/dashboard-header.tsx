"use client"

import { Button } from "@/components/ui/button";
import { Bell, Search, Settings, LifeBuoy, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { WorldClocks } from "./world-clocks";
import { useAuth, useUser } from "@/firebase";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { AdminImpersonationDialog } from "@/components/admin/admin-impersonation-dialog";
import { ShieldAlert } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { CommunityLinks } from "./community-links";

export function DashboardHeader() {
  const { user, isAdmin } = useUser();
  const auth = useAuth();
  const [showAdminDialog, setShowAdminDialog] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // 成功登出后，页面通常会自动重定向或刷新（由 useUser 状态变化触发）
    } catch (error) {
      console.error("登出失败:", error);
    }
  };

  const getWelcomeText = () => {
    if (!user) return 'Not Logged In';
    return user.displayName || user.email;
  }


  return (
    <header className="sticky top-0 z-30 flex h-[40px] items-center justify-between gap-4 border-b-2 border-primary bg-background/50 backdrop-blur-sm px-4 md:px-6">
      <WorldClocks />
      <div className="flex items-center gap-4">
        <CommunityLinks />
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="px-3 py-1 h-auto text-sm rounded-full border-2 border-primary border-dashed">
              <span>欢迎, {getWelcomeText()}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{user ? user.displayName || user.email : '我的账户'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/settings">
              <DropdownMenuItem className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                <span>设置</span>
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem>
              <LifeBuoy className="mr-2 h-4 w-4" />
              <span>支持</span>
            </DropdownMenuItem>

            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowAdminDialog(true)} className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20">
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  <span>管理员控制台</span>
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>登出</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AdminImpersonationDialog open={showAdminDialog} onOpenChange={setShowAdminDialog} />
    </header>
  );
}
