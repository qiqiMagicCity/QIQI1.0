"use client";

import { cn } from "@/lib/utils";

export type Status = 'live' | 'Ready' | 'stale' | 'close';

export function StatusBadge({ status, className }: { status: Status, className?: string }) {
  const map = {
    live:  { label: '盘中',     cls: 'badge-live' },
    Ready: { label: '开盘就绪', cls: 'badge-ready' },
    stale: { label: '待更新',   cls: 'badge-stale' },
    close: { label: '已收盘',   cls: 'badge-close' },
  } as const;
  
  const m = map[status] ?? map.close;
  
  return (
    <div className={cn('badge', m.cls, className)}>
      <div className="badge-dot" />
      <span>{m.label}</span>
    </div>
  );
}
