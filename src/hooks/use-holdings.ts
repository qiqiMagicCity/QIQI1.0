'use client';

import { useHoldingsContext } from '@/contexts/holdings-provider';

export type { HoldingRow, HoldingsSummary } from '@/contexts/holdings-provider';

export function useHoldings() {
  return useHoldingsContext();
}