'use client';

import { cn } from '@/lib/utils';
import type { OpKind } from '@/hooks/use-user-transactions';
import {
  ArrowUpRight,
  ArrowDownLeft,
  TrendingDown,
  Undo2,
} from 'lucide-react';

// 让“操作”列对【股票与期权】使用同一套标签与色板（买入/卖出/卖空/补回）
export function ActionBadge({ opKind }: { opKind: OpKind }) {
  const PALETTE = {
    BUY: 'bg-emerald-600',
    SELL: 'bg-red-600',
    SHORT: 'bg-violet-600',
    COVER: 'bg-blue-600',
    // 期权动作映射到同色板（保持一致）
    BTO: 'bg-emerald-600',
    STC: 'bg-red-600',
    STO: 'bg-violet-600',
    BTC: 'bg-blue-600',
    SPLIT: 'bg-slate-500',
  } as const;

  const Icon =
    opKind === 'SHORT' || opKind === 'STO' ? TrendingDown
      : opKind === 'COVER' || opKind === 'BTC' ? Undo2
        : opKind === 'SELL' || opKind === 'STC' ? ArrowDownLeft
          : ArrowUpRight;

  const text =
    opKind === 'BTO' ? '买入' :
      opKind === 'STO' ? '卖空' :
        opKind === 'STC' ? '卖出' :
          opKind === 'BTC' ? '补回' :
            opKind === 'SELL' ? '卖出' :
              opKind === 'SHORT' ? '卖空' :
                opKind === 'COVER' ? '补回' : '买入';

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-white', PALETTE[opKind])}>
      <Icon className="w-3.5 h-3.5" />
      <span>{text}</span>
    </span>
  );
}
