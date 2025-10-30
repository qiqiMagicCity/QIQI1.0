import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Bell, Search, Settings, LifeBuoy, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";

export function DashboardHeader() {
  const userAvatar = PlaceHolderImages.find(p => p.id === 'userAvatar');

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b bg-card px-4 md:px-6">
        <div className="flex items-center gap-4">
            <div>
                <h1 className="text-lg font-semibold md:text-xl">
                    仪表盘
                </h1>
                <p className="text-sm text-muted-foreground">欢迎来到绿トレーダー分析</p>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="rounded-full">
                <Search className="h-5 w-5" />
                <span className="sr-only">搜索</span>
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full">
                <Bell className="h-5 w-5" />
                <span className="sr-only">通知</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar className="h-9 w-9">
                    {userAvatar && <AvatarImage src={userAvatar.imageUrl} alt="用户头像" data-ai-hint={userAvatar.imageHint} />}
                    <AvatarFallback>GT</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>设置</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  <span>支持</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>登出</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
    </header>
  );
}
