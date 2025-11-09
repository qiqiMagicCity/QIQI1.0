
"use client";

import { cn } from "@/lib/utils";

export type Status =
  | 'live'
  | 'closed'
  | 'session-pre'
  | 'session-post'
  | 'missing-ref-eod'
  | 'missing-today-eod'
  | 'pending-eod-fetch'
  | 'stale-last'
  | 'degraded';

export function StatusBadge({ status, className }: { status: Status, className?: string }) {
  const map: Record<Status, { label: string; cls: string }> = {
    live:                { label: '盘中',           cls: 'badge-live' },
    closed:              { label: '已收盘',         cls: 'badge-close' },
    'session-pre':       { label: '盘前',           cls: 'badge-info' },
    'session-post':      { label: '盘后',           cls: 'badge-info' },
    'missing-ref-eod':   { label: '缺昨收',         cls: 'badge-error' },
    'missing-today-eod': { label: '缺今收',         cls: 'badge-warning' },
    'pending-eod-fetch': { label: 'EOD获取中',      cls: 'badge-pending' },
    'stale-last':        { label: '价格延迟',       cls: 'badge-warning' },
    degraded:            { label: '数据降级',       cls: 'badge-error' },
  };
  
  const m = map[status] ?? map.degraded;
  const isBlinking = status === 'live' || status === 'stale-last';

  return (
    <div className={cn('badge', m.cls, className)}>
      <div className="relative flex h-2 w-2">
        {isBlinking && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>}
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
      </div>
      <span>{m.label}</span>
    </div>
  );
}

