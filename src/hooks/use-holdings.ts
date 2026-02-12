import type { AuditEvent } from '@/lib/pnl/calc-m4-m5-2-global-fifo'; // [NEW]
import { useHoldingsContext } from '@/contexts/holdings-provider'; // [FIX] Import context hook
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
  allTransactions: any[]; // [NEW] For Audit
  isAutoHealing: boolean; // [NEW]
  autoHealProgress?: { total: number; current: number; status: string } | null; // [NEW]
  isLiveMode: boolean; // [NEW]
  auditTrail?: AuditEvent[]; // [NEW]
  historicalPnlMetrics?: { // [NEW]
    totalSymbols: number;
    invalidPnlCount: number;
    aggregatedCount: number;
  };
};

export function useHoldings(): UseHoldingsResult {
  const context = useHoldingsContext();
  return {
    allTransactions: context.allTransactions,
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
    isAutoHealing: context.isAutoHealing, // [NEW]
    autoHealProgress: context.autoHealProgress, // [NEW]
    isLiveMode: context.isLiveMode, // [NEW]
    auditTrail: context.auditTrail, // [NEW]
    historicalPnlMetrics: context.historicalPnlMetrics, // [NEW]
  };
}