"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

export function DashboardHeader() {
  const { user } = useUser();
  const auth = useAuth();

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
            <Button variant="ghost" size="icon" className="rounded-full">
                <Search className="h-5 w-5" />
                <span className="sr-only">搜索</span>
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full relative">
                <Bell className="h-5 w-5" />
                <span className="sr-only">通知</span>
                <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/90"></span>
                </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="px-2">
                  <span className="font-medium text-sm">欢迎, {getWelcomeText()}</span>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>登出</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
    </header>
  );
}
