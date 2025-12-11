export const MAX_SYMBOLS_PER_CALL = 50;                 // 用户直连 onCall
export const MAX_SYMBOLS_PER_BACKFILL_REQUEST = 50;     // 后台回填请求 onCall
export const EOD_JOB_CHUNK_SIZE = 50;                   // eodJob 分批大小
export const MAX_DOCIDS_PER_QUERY = 30;                 // 前端 Firestore in 查询上限
export const MAX_SYMBOLS_PER_SET_OPERATION = 500;       // setEodSymbols 单次上限（已存在的口径）
export const MAX_TOTAL_EOD_SYMBOLS = 2000;              // eod 列表总量上限（已存在的口径）
export const BACKFILL_WORKER_CHUNK_SIZE = 50;
export const BACKFILL_WORKER_CONCURRENCY = 5;