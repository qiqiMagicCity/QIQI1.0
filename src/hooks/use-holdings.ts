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
  refreshData: () => void;
  analysisYear?: number;
  setAnalysisYear?: (y: number) => void;
  ytdBaseEodMap?: Record<string, OfficialCloseResult>; // [NEW]
  activeSplits?: any[]; // [NEW]
  showHidden: boolean;
  setShowHidden: (show: boolean) => void;
  toggleHidden: (symbol: string) => void;
  effectiveUid: string | null; // [NEW] Needed for writes
  availableYears?: number[]; // [NEW] From Provider
};

export function useHoldings(): UseHoldingsResult {
  const context = useHoldingsContext();
  return {
    rows: context.rows,
    summary: context.summary,
    historicalPnl: context.historicalPnl,
    dailyPnlList: context.dailyPnlList,
    dailyPnlResults: context.dailyPnlResults,
    pnlEvents: (context.pnlEvents ?? []) as { date: string; pnl: number }[],
    fullEodMap: context.fullEodMap,
    loading: context.loading,
    isCalculating: context.isCalculating,
    transactions: context.transactions,
    refreshData: context.refreshData,
    analysisYear: context.analysisYear,
    setAnalysisYear: context.setAnalysisYear,
    ytdBaseEodMap: context.ytdBaseEodMap, // [NEW]
    activeSplits: context.activeSplits, // [NEW]
    showHidden: context.showHidden,
    setShowHidden: context.setShowHidden,
    toggleHidden: context.toggleHidden,
    effectiveUid: context.effectiveUid, // [NEW]
    availableYears: context.availableYears, // [NEW]
  };
}