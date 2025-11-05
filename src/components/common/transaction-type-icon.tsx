'use client';

import { Buy, Sell } from '@icon-park/react';
import { cn } from '@/lib/utils';
import type { Tx } from '@/lib/holdings/fifo';

interface TransactionTypeIconProps {
  type: Tx['type'];
  className?: string;
}

export function TransactionTypeIcon({ type, className }: TransactionTypeIconProps) {
  const iconProps = {
    className: cn("h-4 w-4", className),
    theme: "outline" as const,
    strokeWidth: 3,
  };

  switch (type) {
    case 'BUY':
      return <Buy {...iconProps} className={cn(iconProps.className, 'text-green-500')} />;
    case 'SELL':
      return <Sell {...iconProps} className={cn(iconProps.className, 'text-red-500')} />;
    case 'SHORT':
      return <Sell {...iconProps} className={cn(iconProps.className, 'text-orange-500')} />;
    case 'COVER':
      return <Buy {...iconProps} className={cn(iconProps.className, 'text-blue-500')} />;
    default:
      return null;
  }
}
