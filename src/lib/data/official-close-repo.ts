import {
  getFirestore,
  getDocs,
  collection,
  query,
  where,
  documentId,
  doc,
  setDoc,
  Timestamp
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { initializeFirebase } from '@/firebase';
import { countCall } from '@/lib/snapshots/pnl-snapshot-repo';
import { toNyCalendarDayString, prevNyTradingDayString, isNyTradingDay } from '@/lib/ny-time';
import { EodCache, type CachedOfficialClose } from '@/lib/cache/eod-close-cache';

import { EodStatus } from '../types/pnl-status';

// --- 类型定义 ---
export interface OfficialCloseResult {
  status: EodStatus;
  close?: number;
  tradingDate?: string;
  provider?: string;
  rev?: number; // Added for cache revision
  quality?: string; // [NEW] Original status quality tag (e.g., 'ok', 'no_liquidity')
  meta?: Record<string, any>; // [NEW] Metadata for signals like fetch_incomplete
}

// --- 全局状态：在途请求去重集合 ---
const pendingBackfills = new Set<string>();

// --- 全局 Revision 内存缓存 (Pitfall B Fix) ---
// Key: Symbol, Value: { rev: number, ts: number }
const revisionCache = new Map<string, { rev: number; ts: number }>();
const REV_CACHE_TTL = 15 * 1000; // 15 Seconds (Close-Loop responsiveness)

// --- 全局内存缓存 (Memory Cache) ---
// Key: `${tradingDate}_${symbol}`
const resultCache = new Map<string, OfficialCloseResult>();

/**
 * 辅助：批量获取 Symbol 的当前 EOD 版本号 (eodRevision)
 * 来源：Firestore 'stockDetails/{symbol}' (字段 eodRevision)
 * 
 * 优化：使用 documentId() IN 查询，每 10-30 个一批
 */
export async function getSymbolRevisions(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols || symbols.length === 0) return {};

  const revisions: Record<string, number> = {};
  const missingSymbols: string[] = [];
  const now = Date.now();

  // 1. Check Memory Cache
  // Use unique set for checking
  const uniqueSymbols = Array.from(new Set(symbols));

  uniqueSymbols.forEach(s => {
    const cached = revisionCache.get(s);
    if (cached && (now - cached.ts < REV_CACHE_TTL)) {
      revisions[s] = cached.rev;
    } else {
      missingSymbols.push(s);
    }
  });

  if (missingSymbols.length === 0) return revisions;

  // 2. Fetch Missing from Firestore
  const { firestore } = initializeFirebase();
  const chunks: string[][] = [];

  for (let i = 0; i < missingSymbols.length; i += 30) {
    chunks.push(missingSymbols.slice(i, i + 30));
  }

  try {
    const colRef = collection(firestore, 'stockDetails');
    const promises = chunks.map(chunk => {
      countCall('getDocs');
      return getDocs(query(colRef, where(documentId(), 'in', chunk)));
    });

    const snapshots = await Promise.all(promises);

    snapshots.forEach(snap => {
      snap.forEach(d => {
        const data = d.data();
        const symbol = d.id; // Doc ID is Symbol
        const rev = typeof data.eodRevision === 'number' ? data.eodRevision : 0;

        revisions[symbol] = rev;
        // Write to Cache
        revisionCache.set(symbol, { rev, ts: now });
      });
    });

    // Fill missing as 0
    missingSymbols.forEach(s => {
      if (revisions[s] === undefined) {
        revisions[s] = 0;
        revisionCache.set(s, { rev: 0, ts: now });
      }
    });

  } catch (e) {
    console.warn('[Repo] Failed to fetch symbol revisions', e);
    // Fallback: assume 0 for all
    missingSymbols.forEach(s => revisions[s] = 0);
  }

  return revisions;
}

/**
 * 批量获取 EOD 数据 (Safe Mode + Split Aware)
 * 1. Fetch current revision for symbols.
 * 2. Check IndexedDB.
 * 3. Match revisions:
 *    - Match: Use cache.
 *    - Mismatch: Flush cache for symbol, re-fetch.
 * 4. Fetch missing from Firestore.
 * 5. Write back with rev.
 */
export async function getOfficialCloses(
  tradingDate: string,
  symbols: string[]
): Promise<Record<string, OfficialCloseResult>> {

  if (!symbols || symbols.length === 0) return {};

  const { firestore } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};

  // A. Fetch current revisions (The Source of Truth for validity)
  const revisions = await getSymbolRevisions(symbols);

  // B. Check IndexedDB first
  const keys = symbols.map(s => `${tradingDate}_${s}`);
  const idbResults = await EodCache.getMany(keys);

  const symbolsToFetch: string[] = [];
  const symbolsToFlushCache: Set<string> = new Set();
  const newCacheEntries: Record<string, CachedOfficialClose> = {};

  // C. Process Logic
  symbols.forEach(s => {
    const key = `${tradingDate}_${s}`;
    const targetRev = revisions[s] || 0;

    const cached = idbResults[key]; // From IDB

    let validCacheFound = false;

    const isValid = cached && (cached.status === 'ok' || cached.status === 'plan_limited' || cached.status === 'no_liquidity');
    if (isValid) {
      const cachedRev = cached.rev || 0;
      if (cachedRev === targetRev) {
        // Valid Hit
        results[s] = cached;
        resultCache.set(key, cached); // Update mem cache
        validCacheFound = true;
      } else {
        // Stale Revision! Stock Split likely happened.
        console.log(`[Repo] Stale Cache Detected for ${s}. Rev ${cachedRev} vs Target ${targetRev}. Flushing...`);
        symbolsToFlushCache.add(s);
      }
    }

    // Check Memory Cache as fallback/second layer (if IDB failed but mem has it?)
    // Actually, stick to invalidation logic. If IDB was stale, mem is likely stale.

    if (!validCacheFound) {
      // Mark for fetch
      results[s] = { status: 'missing' };
      symbolsToFetch.push(s);
    }
  });

  // D. Flush stale caches if any
  if (symbolsToFlushCache.size > 0) {
    // Clear ALL cache entries for these symbols, not just this date.
    await EodCache.clearSymbols(Array.from(symbolsToFlushCache));
    // Also clear memory cache
    for (const s of symbolsToFlushCache) {
      for (const k of resultCache.keys()) {
        if (k.endsWith(`_${s}`)) {
          resultCache.delete(k);
        }
      }
    }
  }

  if (symbolsToFetch.length === 0) {
    return results;
  }

  // E. Fetch from Firestore (Only missing ones)
  try {
    const colRef = collection(firestore, 'officialCloses');
    const chunks: string[][] = [];
    const chunkSize = 10;
    const fetchIds = symbolsToFetch.map(s => `${tradingDate}_${s}`);

    for (let i = 0; i < fetchIds.length; i += chunkSize) {
      chunks.push(fetchIds.slice(i, i + chunkSize));
    }

    const snapshots = await Promise.all(
      chunks.map(chunk => {
        const q = query(colRef, where(documentId(), 'in', chunk));
        return getDocs(q);
      })
    );

    snapshots.forEach((snap, chunkIdx) => {
      const currentChunk = chunks[chunkIdx];
      // Log for each requested ID in the chunk
      currentChunk.forEach(reqId => {
        const foundDoc = snap.docs.find(d => d.id === reqId);

        console.log(`[Repo-Audit] Query Doc: ${reqId}, Exists: ${!!foundDoc}`);
        if (foundDoc) {
          const d = foundDoc;
          const data = d.data();
          console.log(`  -> Data: status=${data.status}, close=${data.close}`);
        }
      });

      snap.forEach(d => {
        const data = d.data();
        const effectiveTradingDate = data.tradingDate || data.date;

        if (data.symbol) {
          const currentRev = revisions[data.symbol] || 0;

          const mappedStatus = ['ok', 'plan_limited', 'no_liquidity'].includes(data.status) ? data.status : 'error';
          const result: CachedOfficialClose = {
            status: mappedStatus as any,
            close: data.close,
            tradingDate: effectiveTradingDate,
            provider: data.provider,
            rev: currentRev, // Bind current rev
            symbol: data.symbol // Bind symbol for indexing
          };

          results[data.symbol] = result;

          // Prepare for Cache
          const key = `${tradingDate}_${data.symbol}`;
          resultCache.set(key, result);
          newCacheEntries[key] = result;
        }
      });
    });

    // F. Write back to IndexedDB
    if (Object.keys(newCacheEntries).length > 0) {
      EodCache.setMany(newCacheEntries).catch(err => console.warn('[Repo] Cache write failed', err));
    }

  } catch (e) {
    console.error("[Repo] Failed to fetch officialCloses", e);
  }

  return results;
}

/**
 * [NEW] 将实时价格保存为 EOD 数据
 */
export async function saveRealTimeAsEod(
  tradingDate: string,
  symbol: string,
  price: number
): Promise<void> {
  const { firebaseApp } = initializeFirebase();
  const functions = getFunctions(firebaseApp, 'us-central1');
  const saveFn = httpsCallable(functions, 'saveRealTimeEod');

  await saveFn({
    date: tradingDate,
    symbol,
    price
  });

  console.log(`[Repo] Saved Real-time EOD for ${symbol} on ${tradingDate}: ${price}`);
}

/**
 * [NEW] 手动补录 EOD 数据
 * 直接写入 Firestore，覆盖现有数据。
 */
export async function saveManualEod(
  tradingDate: string,
  symbol: string,
  price: number
): Promise<void> {
  if (!tradingDate || !symbol || typeof price !== 'number') return;

  // Use Cloud Function to bypass client rules
  const { firebaseApp } = initializeFirebase();
  const functions = getFunctions(firebaseApp, 'us-central1');
  const saveFn = httpsCallable(functions, 'saveRealTimeEod');

  try {
    await saveFn({
      date: tradingDate,
      symbol,
      price
    });

    const docId = `${tradingDate}_${symbol}`;
    console.log(`[Repo] Manual EOD Saved via Function: ${docId} => ${price}`);

    // Update Cache immediately to avoid stale read on refresh
    const result: CachedOfficialClose = {
      status: 'ok',
      close: price,
      tradingDate: tradingDate,
      provider: 'manual',
      symbol,
      rev: 0
    };
    resultCache.set(docId, result);
    await EodCache.setMany({ [docId]: result });
  } catch (e) {
    console.error("[Repo] Failed to save manual EOD", e);
    throw e;
  }
}

/**
 * 获取指定标的在指定日期范围内的 EOD 数据
 * Update: Added simple revision check (optional but consistant)
 */
export async function getSymbolCloses(
  symbol: string,
  dates: string[]
): Promise<Record<string, OfficialCloseResult>> {
  if (!symbol || dates.length === 0) return {};

  const { firestore } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};
  const docIds = dates.map(d => `${d}_${symbol}`);
  const colRef = collection(firestore, 'officialCloses');

  // Chunking
  const chunks: string[][] = [];
  const chunkSize = 10;
  for (let i = 0; i < docIds.length; i += chunkSize) {
    chunks.push(docIds.slice(i, i + chunkSize));
  }

  try {
    const snapshots = await Promise.all(
      chunks.map(chunk => {
        const q = query(colRef, where(documentId(), 'in', chunk));
        return getDocs(q);
      })
    );

    snapshots.forEach(snap => {
      snap.forEach(d => {
        const data = d.data();
        const datePart = d.id.split('_')[0];

        results[datePart] = {
          status: data.status === 'ok' ? 'ok' : 'error',
          close: data.close,
          tradingDate: datePart,
          provider: data.provider
        };
      });
    });
  } catch (e) {
    console.error("[Repo] Failed to fetch symbol closes", e);
  }

  return results;
}

/**
 * 批量获取指定日期范围内的 EOD 数据
 * Note: Range queries are harder to use ID cache efficiently without multi-get loops.
 * Keeping simple Firestore fetch for now, but disabling auto-backfill.
 */
/**
 * 批量获取指定日期范围内的 EOD 数据
 * Update (Pitfall A Fix): Delegate to batch fetch if symbols provided.
 * This ensures 'Rev-Aware' caching is used for Calendar/Charts too.
 */
export async function getOfficialClosesRange(
  startDate: string,
  endDate: string,
  symbols?: string[],
  options: { includePrevTradingDay?: boolean } = {}
): Promise<Record<string, OfficialCloseResult>> {

  let actualStartDate = startDate;
  if (options.includePrevTradingDay) {
    actualStartDate = prevNyTradingDayString(startDate);
  }

  // 1. If symbols provided, use "Batch" mode (Cache + Rev supported)
  if (symbols && symbols.length > 0) {
    // Generate trading dates
    const dates: string[] = [];
    let curr = new Date(actualStartDate);
    const end = new Date(endDate);

    const MAX_DAYS = 1500; // Safety Cap
    let count = 0;
    let isTruncated = false;

    let lastResultDate = actualStartDate;
    while (curr <= end) {
      if (count >= MAX_DAYS) {
        isTruncated = true;
        break;
      }
      const dStr = curr.toISOString().split('T')[0];
      if (isNyTradingDay(dStr)) {
        dates.push(dStr);
        lastResultDate = dStr;
      }
      curr.setDate(curr.getDate() + 1);
      count++;
    }

    const results = await getOfficialClosesBatch(dates, symbols);

    if (isTruncated) {
      // [S1] Explicitly mark the boundary to signal truncation to the caller.
      results['FETCH_INCOMPLETE_BOUNDARY'] = {
        status: 'fetch_incomplete',
        meta: { lastFetchedDate: lastResultDate, endDate }
      };
    }
    return results;
  }

  // 2. Fallback: Raw Range Query (No Caching, No Revision Check)
  // Used only for "Whole Market" analysis if any.
  const { firestore } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};
  const colRef = collection(firestore, 'officialCloses');

  try {
    const q = query(
      colRef,
      where('tradingDate', '>=', actualStartDate),
      where('tradingDate', '<=', endDate)
    );
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (data.symbol) {
        results[d.id] = { status: 'ok', close: data.close, tradingDate: data.tradingDate };
      }
    });
  } catch (e) {
    console.error("[Repo] Failed to fetch range closes", e);
  }

  return results;
}

/**
 * 批量获取指定日期和标的的 EOD 数据 (By ID)
 * Updated to support revision check.
 */
export async function getOfficialClosesBatch(
  dates: string[],
  symbols: string[]
): Promise<Record<string, OfficialCloseResult>> {
  if (!dates.length || !symbols.length) return {};

  // DEBUG:EOD-BATCH-AUDIT
  if (symbols.includes("NVDA") || symbols.includes("nvda")) {
    console.log(`[EOD-BATCH-AUDIT] batchInput {
      datesRange: "${dates[0]} -> ${dates[dates.length - 1]}",
      datesCount: ${dates.length},
      symbolsCount: ${symbols.length},
      includesNVDA: true,
      sampleSymbols: ${JSON.stringify(symbols.slice(0, 20))}
    }`);
  }

  // Reuse getOfficialCloses logic concepts but adapt for batch
  const { firestore } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};
  const colRef = collection(firestore, 'officialCloses');

  // 1. Get Revisions
  const revisions = await getSymbolRevisions(symbols);

  const allIds: string[] = [];
  // Need to map ID -> Symbol to look up revision
  const idToSymbol: Record<string, string> = {};

  for (const date of dates) {
    for (const sym of symbols) {
      const id = `${date}_${sym}`;
      allIds.push(id);
      idToSymbol[id] = sym;
    }
  }

  // 2. Try Cache
  const cached = await EodCache.getMany(allIds);
  const missingIds: string[] = [];
  const symbolsToFlushCache: Set<string> = new Set();

  allIds.forEach(id => {
    const sym = idToSymbol[id];
    const targetRev = revisions[sym] || 0;
    const entry = cached[id];

    const isEntryValid = !!entry && typeof entry.close === 'number' && Number.isFinite(entry.close);

    if (isEntryValid) {
      if (entry!.rev === targetRev) {
        results[id] = entry!;
        resultCache.set(id, entry);
      } else {
        // Stale
        symbolsToFlushCache.add(sym);
        missingIds.push(id);
      }
    } else {
      missingIds.push(id);
    }
  });

  // 3. Flush
  if (symbolsToFlushCache.size > 0) {
    await EodCache.clearSymbols(Array.from(symbolsToFlushCache));
    for (const s of symbolsToFlushCache) {
      for (const k of resultCache.keys()) {
        if (k.endsWith(`_${s}`)) {
          resultCache.delete(k);
        }
      }
    }
  }

  if (missingIds.length === 0) return results;

  const chunks: string[][] = [];
  const chunkSize = 30;
  for (let i = 0; i < missingIds.length; i += chunkSize) {
    chunks.push(missingIds.slice(i, i + chunkSize));
  }

  // DEBUG:EOD-BATCH-AUDIT
  if (symbols.includes("NVDA")) {
    console.log(`[EOD-BATCH-AUDIT] chunkQuery {
       totalMissingIds: ${missingIds.length},
       chunksCount: ${chunks.length},
       includesNVDA_Query: ${missingIds.some(id => id.includes("NVDA"))}
     }`);
  }

  let totalKeptOk = 0;
  let totalKeptNoLiquidity = 0;
  let totalKeptUnknown = 0;
  let totalDroppedNoClose = 0;

  try {
    const promises = chunks.map(chunk => {
      const q = query(colRef, where(documentId(), 'in', chunk));
      return getDocs(q);
    });

    const snapshots = await Promise.all(promises);
    const newCacheEntries: Record<string, CachedOfficialClose> = {};

    snapshots.forEach((snap, chunkIdx) => {
      const currentChunk = chunks[chunkIdx];

      // DEBUG:EOD-BATCH-AUDIT
      if (symbols.includes("NVDA")) {
        console.log(`[EOD-BATCH-AUDIT] chunkResult {
          chunkIndex: ${chunkIdx},
          docsCount: ${snap.size},
          has_2026_01_06_NVDA: ${snap.docs.some(d => d.id === "2026-01-06_NVDA")},
          has_2026_01_05_NVDA: ${snap.docs.some(d => d.id === "2026-01-05_NVDA")},
          has_2026_01_02_NVDA: ${snap.docs.some(d => d.id === "2026-01-02_NVDA")},
          firstIds: ${JSON.stringify(snap.docs.slice(0, 5).map(d => d.id))}
        }`);
      }

      currentChunk.forEach(reqId => {
        const foundDoc = snap.docs.find(d => d.id === reqId);
        console.log(`[Repo-Audit-Batch] Query Doc: ${reqId}, Exists: ${!!foundDoc}`);
      });

      let beforeCount = 0;
      let afterCount = 0;
      let keptOk = 0;
      let keptNoLiquidity = 0;
      let keptUnknown = 0;
      let droppedNoClose = 0;

      snap.forEach(d => {
        const data = d.data();
        beforeCount++;

        if (data.symbol) {
          const currentRev = revisions[data.symbol] || 0;
          const rawStatus = (data.status ?? 'unknown');
          const closeValue = data.close;
          const hasClose = typeof closeValue === 'number' && Number.isFinite(closeValue);

          const mappedStatus = hasClose ? 'ok' : 'error';

          if (hasClose) {
            afterCount++;
            if (rawStatus === 'ok') keptOk++;
            else if (rawStatus === 'no_liquidity') keptNoLiquidity++;
            else keptUnknown++;
          } else {
            droppedNoClose++;
          }

          // DEBUG:EOD-BATCH-AUDIT
          if (d.id.includes("NVDA") && d.id.startsWith("2026-01")) {
            console.log(`[EOD-BATCH-AUDIT] nvdaDocPath {
               docId: "${d.id}",
               rawStatus: "${rawStatus}",
               mappedStatus: "${mappedStatus}",
               close: ${closeValue},
               hasClose: ${hasClose}
             }`);
          }

          const res: CachedOfficialClose = {
            status: mappedStatus as any,
            close: closeValue,
            tradingDate: data.tradingDate || d.id.split('_')[0],
            provider: data.provider,
            rev: currentRev,
            symbol: data.symbol,
            quality: rawStatus
          };
          results[d.id] = res;
          resultCache.set(d.id, res);
          newCacheEntries[d.id] = res;
        }
      });

      totalKeptOk += keptOk;
      totalKeptNoLiquidity += keptNoLiquidity;
      totalKeptUnknown += keptUnknown;
      totalDroppedNoClose += droppedNoClose;

      // DEBUG:EOD-BATCH-AUDIT
      if (symbols.includes("NVDA")) {
        console.log(`[EOD-BATCH-AUDIT] filterStats {
           beforeCount: ${beforeCount},
           afterCount: ${afterCount},
           droppedCount: ${beforeCount - afterCount}
        }`);
      }
    });

    console.log(`[EOD-STATUS-AUDIT] totalSummary { totalKeptOk: ${totalKeptOk}, totalKeptNoLiquidity: ${totalKeptNoLiquidity}, totalKeptUnknown: ${totalKeptUnknown}, totalDroppedNoClose: ${totalDroppedNoClose} }`);

    // Write back
    if (Object.keys(newCacheEntries).length > 0) {
      EodCache.setMany(newCacheEntries).catch(e => console.warn(e));
    }

    // DEBUG:EOD-TIMELINE-AUDIT
    // We import dynamically if possible or just use global if we injected it.
    // To be safe, try dynamic import if performance.now is available (browser side).
    if (typeof window !== 'undefined') {
      import('@/lib/debug/eod-timeline').then(({ audit }) => {
        audit("getOfficialClosesBatch.done", {
          rangeStart: dates[0],
          rangeEnd: dates[dates.length - 1],
          totalDocs: Object.keys(results).length,
          has_2026_01_06_NVDA: "2026-01-06_NVDA" in results,
          has_2026_01_05_NVDA: "2026-01-05_NVDA" in results,
          has_2026_01_02_NVDA: "2026-01-02_NVDA" in results
        });
      });
    }

  } catch (e: any) {
    console.error("[Repo] Failed to fetch batch closes", e);
    console.log(`[Repo-Audit-Error] Code: ${e.code}, Message: ${e.message}`);
  }

  return results;
}

/**
 * Manually trigger backfill.
 * [SAFETY] Strict limits: Max 20 symbols. Explicit boolean required. No automatic retry.
 */
export async function triggerManualBackfill(
  date: string,
  symbols: string[],
  authorized: boolean
): Promise<void> {
  if (!authorized) {
    console.warn('[Repo] Manual backfill rejected: Not authorized.');
    return;
  }
  if (!symbols || symbols.length === 0) return;

  if (symbols.length > 20) {
    console.warn(`[Repo] Manual backfill rejected: Too many symbols (${symbols.length} > 20).`);
    return; // Fail safe
  }

  const { firebaseApp } = initializeFirebase();
  const functions = getFunctions(firebaseApp, 'us-central1');
  const requestBackfillFn = httpsCallable(functions, 'requestBackfillEod');

  console.log(`[Repo] Manual Backfill Triggered for ${date}, symbols: ${symbols.join(', ')}`);

  // Check pending deduplication
  const actualSymbols: string[] = [];
  symbols.forEach(s => {
    const key = `${date}_${s}`;
    if (!pendingBackfills.has(key)) {
      pendingBackfills.add(key);
      actualSymbols.push(s);
    }
  });

  if (actualSymbols.length === 0) {
    console.log(`[Repo] All symbols for ${date} are already pending backfill.`);
    return;
  }

  try {
    await requestBackfillFn({ date, symbols: actualSymbols });

    // [FIX] Invalidate Client Cache immediately so next fetch logic sees the "hole" and re-queries Firestore
    // Using clearSymbols is nuclear but safe: it forces a fresh fetch for the *entire* symbol history,
    // ensuring we don't have fragmented or stale state (e.g. rev mismatches).
    await EodCache.clearSymbols(actualSymbols);

    // Also clear memory cache
    for (const s of actualSymbols) {
      for (const k of resultCache.keys()) {
        if (k.endsWith(`_${s}`)) {
          resultCache.delete(k);
        }
      }
    }
    console.log(`[Repo] Invalidated ALL cache for symbols: ${actualSymbols.join(', ')}`);

    setTimeout(() => {
      actualSymbols.forEach(s => pendingBackfills.delete(`${date}_${s}`));
    }, 5000);
  } catch (err) {
    console.error(`[Repo] Manual Backfill failed for ${date}`, err);
    actualSymbols.forEach(s => pendingBackfills.delete(`${date}_${s}`));
    throw err;
  }
}