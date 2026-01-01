'use client';

import { useHoldingsContext } from '@/contexts/holdings-provider';
import type { OfficialCloseResult } from '@/lib/data/official-close-repo';

export type { HoldingRow, HoldingsSummary } from '@/contexts/holdings-provider';

export type UseHoldingsResult = {
  rows: ReturnType<typeof useHoldingsContext>['rows'];
  summary: ReturnType<typeof useHoldingsContext>['summary'];
  historicalPnl: ReturnType<typeof useHoldingsContext>['historicalPnl'];
  dailyPnlList: ReturnType<typeof useHoldingsContext>['dailyPnlList'];
  dailyPnlResults: ReturnType<typeof useHoldingsContext>['dailyPnlResults'];
  pnlEvents: { date: string; pnl: number }[];
  fullEodMap?: Record<string, OfficialCloseResult>;
  loading: boolean;
  isCalculating: boolean;
  transactions: any[]; // Or strict type if available
};

export function useHoldings(): UseHoldingsResult {
  const context = useHoldingsContext();
  return {
    rows: context.rows,
    summary: context.summary,
    historicalPnl: context.historicalPnl,
    dailyPnlList: context.dailyPnlList,
    dailyPnlResults: context.dailyPnlResults,
    pnlEvents: context.pnlEvents,
    fullEodMap: context.fullEodMap,
    loading: context.loading,
    isCalculating: context.isCalculating,
    transactions: context.transactions
  };
}