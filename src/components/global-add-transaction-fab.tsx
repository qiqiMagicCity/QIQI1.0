'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

import { AddTransactionForm } from '@/components/dashboard/add-transaction-form';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useUser } from '@/firebase';

const EXCLUDED_PATHS = ['/login', '/signup', '/error', '/onboarding', '/healthz'];

export default function GlobalAddTransactionFab() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const { user } = useUser();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  useEffect(() => setMounted(true), []);

  // 仅客户端渲染，避免水合差异
  if (!mounted) return null;

  // 未登录或在排除路径，不渲染
  if (!user) return null;
  if (pathname && EXCLUDED_PATHS.some((p) => pathname.startsWith(p))) return null;

  const TriggerButton = (
    <Button size="icon" aria-label="新增交易" className="h-14 w-14 rounded-full shadow-lg">
      <Plus className="h-6 w-6" />
    </Button>
  );

  const Form = <AddTransactionForm onSuccess={() => setOpen(false)} />;

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed bottom-4 right-4 z-50 md:bottom-6 md:right-6 pb-[env(safe-area-inset-bottom)]">
      {children}
    </div>
  );

  if (isMobile) {
    return (
      <Wrapper>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>{TriggerButton}</SheetTrigger>
          <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>新增交易</SheetTitle>
            </SheetHeader>
            {Form}
          </SheetContent>
        </Sheet>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{TriggerButton}</DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新增交易</DialogTitle>
          </DialogHeader>
          {Form}
        </DialogContent>
      </Dialog>
    </Wrapper>
  );
}