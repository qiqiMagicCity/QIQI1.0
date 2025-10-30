import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Bell, Search } from "lucide-react";

export function DashboardHeader() {
  const userAvatar = PlaceHolderImages.find(p => p.id === 'userAvatar');

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b bg-card px-4 md:px-6">
        <div className="flex items-center gap-4">
            <SidebarTrigger className="md:hidden"/>
            <div className="hidden md:block">
                <h1 className="text-lg font-semibold md:text-xl">
                    Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">Welcome to GreenTrader Analytics</p>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="rounded-full">
                <Search className="h-5 w-5" />
                <span className="sr-only">Search</span>
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full">
                <Bell className="h-5 w-5" />
                <span className="sr-only">Notifications</span>
            </Button>
            <Avatar className="h-9 w-9">
              {userAvatar && <AvatarImage src={userAvatar.imageUrl} alt="User Avatar" data-ai-hint={userAvatar.imageHint} />}
              <AvatarFallback>GT</AvatarFallback>
            </Avatar>
        </div>
    </header>
  );
}
