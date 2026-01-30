import * as admin from "firebase-admin";

// ---- Firebase Admin 初始化 ----
// [COMPLIANT] Rule 5.1: Index file only handles initialization and exports.
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// ==========================================
// ★★★ [内置维护工具箱] 导入外部定义 ★★★
// ==========================================
export { maintenanceTool } from "./admin/maintenance";
// ==========================================

// HTTP Functions
export { getOfficialClose } from "./http/get-official-close"; // [COMPLIANT] Extracted to dedicated file
export { priceQuote } from "./price/price-quote";

// Jobs (Scheduled & Background)
export { eodJob } from "./jobs/eod";
export { backfillWorker } from "./jobs/backfill-worker";
export {
  realtimeEodPass1,
  realtimeEodPass2,
  realtimeEodPass3,
  realtimeEodPass4,
  realtimeEodPass5
} from "./jobs/realtime-eod";
export {
  refreshEodSymbolsFromTransactions,
  refreshEodSymbolsFromTransactionsOnDemand
} from "./jobs/refresh-eod-symbols-from-transactions";
export { manualRunEodForMetaSymbols } from "./jobs/manual-eod-from-meta";
export { serverSideEodJob } from "./jobs/server-side-eod"; // [NEW] Full Auto EOD
export { scheduledDailySnapshot, manualGenerateSnapshot } from "./jobs/generate-daily-snapshot"; // [NEW] Snapshot Job

// Admin / Tools
export { requestBackfillEod } from "./admin/request-backfill-eod";
export { rebuildHistoricalEod } from "./admin/rebuild-historical-eod";
export { setEodSymbols } from "./admin/set-eod-symbols";
export { saveRealTimeEod } from "./admin/save-realtime-eod";
export { processStockSplit } from "./admin/process-stock-split";