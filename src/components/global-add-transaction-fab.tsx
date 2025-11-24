'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddTransactionForm } from '@/components/dashboard/add-transaction-form';
import { BulkAddTransactionForm } from '@/components/dashboard/bulk-add-transaction-form';
import { useSearchParams, useRouter } from "next/navigation";

function CenterFloat({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <div className="relative pointer-events-auto mx-auto mt-[10vh] w-[min(92vw,800px)] max-h-[85vh] overflow-y-auto rounded-2xl border bg-card/95 shadow-2xl backdrop-blur p-6">
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-4 top-4 rounded-full z-20 pointer-events-auto"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </Button>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function GlobalAddTransactionFab() {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();
  const router = useRouter();
  const tx = sp.get("tx");
  const id = sp.get("id");
  const isValidId = id && id !== "null" && id !== "undefined" && id.trim() !== "";

  useEffect(() => {
    const shouldOpen = tx === "new" || tx === "bulk" || (tx === "edit" && isValidId);
    const nextOpen = !!shouldOpen;
    if (open !== nextOpen) setOpen(nextOpen);
  }, [tx, isValidId]);

  const openNewViaUrl = () => {
    const qs = new URLSearchParams(sp.toString());
    qs.set("tx", "new");
    qs.delete("id");
    router.replace(`?${qs.toString()}`, { scroll: false });
  };

  const closeAndCleanUrl = () => {
    const qs = new URLSearchParams(sp.toString());
    qs.delete("tx");
    qs.delete("id");
    router.replace(qs.toString() ? `?${qs.toString()}` : "?", { scroll: false });
    setOpen(false);
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 md:bottom-6 md:right-6 pb-[env(safe-area-inset-bottom)]">
        <Button
          size="icon"
          aria-label="新增交易"
          className="h-14 w-14 rounded-full shadow-lg"
          onClick={openNewViaUrl}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {open && (
        <CenterFloat onClose={closeAndCleanUrl}>
          {tx === 'bulk' ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">批量添加交易</h2>
              <BulkAddTransactionForm onSuccess={closeAndCleanUrl} />
            </div>
          ) : (
            <AddTransactionForm onSuccess={closeAndCleanUrl} />
          )}
        </CenterFloat>
      )}
    </>
  );
}