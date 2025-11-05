'use client';

import { cn } from '@/lib/utils';
import type { OpKind } from '@/hooks/use-user-transactions';
import { ArrowUpRight, ArrowDownLeft, TrendingDown, Undo2 } from 'lucide-react';

interface TransactionTypeIconProps {
  type: OpKind;
  className?: string;
}

export function TransactionTypeIcon({ type, className }: TransactionTypeIconProps) {
  const iconProps = {
    className: cn("h-4 w-4", className),
    strokeWidth: 2,
  };

  // Map option actions to the same icons as stock actions for consistency
  switch (type) {
    case 'BUY':
    case 'BTO': // Buy to Open
      return <ArrowUpRight {...iconProps} className={cn(iconProps.className, 'text-green-500')} />;
    
    case 'SELL':
    case 'STC': // Sell to Close
      return <ArrowDownLeft {...iconProps} className={cn(iconProps.className, 'text-red-500')} />;

    case 'SHORT':
    case 'STO': // Sell to Open
      return <TrendingDown {...iconProps} className={cn(iconProps.className, 'text-orange-500')} />;

    case 'COVER':
    case 'BTC': // Buy to Close
      return <Undo2 {...iconProps} className={cn(iconProps.className, 'text-blue-500')} />;
      
    default:
      // Provide a fallback or handle unexpected types
      return null;
  }
}
