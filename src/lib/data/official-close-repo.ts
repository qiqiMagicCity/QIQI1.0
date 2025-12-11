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
import { initializeFirebase } from '@/firebase'; // 确保这个路径指向 src/firebase/index.ts
import { toNyCalendarDayString, isNyTradingDay } from '@/lib/ny-time';

// --- 类型定义 ---
export interface OfficialCloseResult {
  status: 'ok' | 'error' | 'missing' | 'pending' | 'stale';
  close?: number;
  tradingDate?: string;
  provider?: string;
}

// --- 全局状态：在途请求去重集合 (9.3.1 规则) ---
// 作用：防止手抖或页面刷新时，重复发送一模一样的补齐请求
const pendingBackfills = new Set<string>();

// --- 全局缓存：EOD 结果缓存 ---
// Key: `${tradingDate}_${symbol}`
const resultCache = new Map<string, OfficialCloseResult>();

// --- 辅助：获取 NY 今日 ---
const getNyToday = () => toNyCalendarDayString(Date.now());

/**
 * 批量获取 EOD 数据
 * 功能：
 * 1. 先查缓存/数据库有没有现成的。
 * 2. 如果没有，且开启了自动补齐，就去呼叫后端。
 * 3. 包含多重保护：不补今天的数据、不重复发请求。
 */
export async function getOfficialCloses(
  tradingDate: string,
  symbols: string[],
  options?: { shouldAutoRequestBackfill?: boolean }
): Promise<Record<string, OfficialCloseResult>> {

  if (!symbols || symbols.length === 0) return {};

  const { firestore, firebaseApp } = initializeFirebase();

  // --- 修正点：这里改成了正确的函数名 'requestBackfillEod' ---
  // 这里的 'us-central1' 是 Google Cloud 的服务器位置，通常不用改，除非你部署在别处
  const functions = getFunctions(firebaseApp, 'us-central1');
  const requestBackfillFn = httpsCallable(functions, 'requestBackfillEod');
  // ---------------------------------------------------------

  // 1. 构建查询 ID 列表
  const docIds = symbols.map(s => `${tradingDate}_${s}`);
  const results: Record<string, OfficialCloseResult> = {};
  const symbolsToFetch: string[] = [];

  // 先查缓存
  symbols.forEach(s => {
    const key = `${tradingDate}_${s}`;
    const cached = resultCache.get(key);
    if (cached && cached.status === 'ok') {
      results[s] = cached;
    } else {
      results[s] = { status: 'missing' };
      symbolsToFetch.push(s);
    }
  });

  if (symbolsToFetch.length === 0) {
    return results;
  }

  // 2. 查库 (Firestore) - Only for symbols not in cache
  try {
    const colRef = collection(firestore, 'officialCloses');
    const chunks: string[][] = [];
    const chunkSize = 10;

    // Only fetch IDs for symbols that need fetching
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

    snapshots.forEach(snap => {
      snap.forEach(d => {
        const data = d.data();

        // 兼容 date / tradingDate
        const rawTradingDate = data.tradingDate;
        const rawDate = data.date;
        const effectiveTradingDate =
          typeof rawTradingDate === "string" && rawTradingDate
            ? rawTradingDate
            : typeof rawDate === "string" && rawDate
              ? rawDate
              : undefined;

        if (data.symbol) {
          results[data.symbol] = {
            status: data.status === 'ok' ? 'ok' : 'error',
            close: data.close,
            tradingDate: effectiveTradingDate,
            provider: data.provider
          };
          // Update Cache
          resultCache.set(`${tradingDate}_${data.symbol}`, results[data.symbol]);
        }
      });
    });
  } catch (e) {
    console.error("[Repo] Failed to fetch officialCloses", e);
    // 如果查库失败，保持 missing 状态，避免崩页面
  }

  // 3. 检查哪些还没查到 & 是否需要触发回填
  const missingSymbols = symbols.filter(s => results[s].status === 'missing');

  if (missingSymbols.length > 0 && options?.shouldAutoRequestBackfill) {

    // 3.1 时间锁 (Time Guard)：绝对禁止补“今天”或“未来”
    // 因为今天的数据要等收盘实时定格，不能靠补齐。
    const today = getNyToday();
    if (tradingDate >= today) {
      console.debug(`[Repo] Skip backfill for today/future: ${tradingDate}`);
      // 将今天的缺失状态改为 'stale' (待更新)，UI 会显示“待更新”而不是“缺失”
      missingSymbols.forEach(s => {
        results[s].status = 'stale';
      });
      return results;
    }

    // 3.2 内存去重 (In-flight Deduplication)：防止重复请求
    const realCandidates = missingSymbols.filter(s => {
      const key = `${tradingDate}_${s}`;
      if (pendingBackfills.has(key)) return false; // 已经在路上了，跳过
      return true;
    });

    if (realCandidates.length > 0) {
      // 标记为“正在请求中”
      realCandidates.forEach(s => pendingBackfills.add(`${tradingDate}_${s}`));

      // 临时将结果标记为 pending，让 UI 显示转圈圈
      realCandidates.forEach(s => {
        results[s].status = 'pending';
      });

      // 发起请求 (后端去干活，我们不傻等结果)
      // [FIX] Batch backfill requests to avoid CF timeout or rate limits
      const backfillChunks: string[][] = [];
      const backfillChunkSize = 5; // Conservative chunk size for external API calls

      for (let i = 0; i < realCandidates.length; i += backfillChunkSize) {
        backfillChunks.push(realCandidates.slice(i, i + backfillChunkSize));
      }

      console.log(`[Repo] Triggering backfill for ${realCandidates.length} symbols in ${backfillChunks.length} chunks on ${tradingDate}`);

      backfillChunks.forEach(chunk => {
        requestBackfillFn({ date: tradingDate, symbols: chunk })
          .then(() => {
            // 成功后，过5秒再释放锁
            setTimeout(() => {
              chunk.forEach(s => pendingBackfills.delete(`${tradingDate}_${s}`));
            }, 5000);
          })
          .catch(err => {
            console.error(`[Repo] Backfill chunk failed for ${chunk.join(', ')}`, err);
            // 失败了立即释放锁
            chunk.forEach(s => pendingBackfills.delete(`${tradingDate}_${s}`));
          });
      });

      // 兜底保险：30秒后无论如何强制释放锁，防止死锁
      setTimeout(() => {
        realCandidates.forEach(s => pendingBackfills.delete(`${tradingDate}_${s}`));
      }, 30000);
    } else {
      // 虽然缺失，但已经在请求路上了，所以也标记为 pending
      missingSymbols.forEach(s => results[s].status = 'pending');
    }
  }

  return results;
}

/**
 * [NEW] 将实时价格保存为 EOD 数据 (仅用于填充今日数据)
 * 对应 GLOBAL_RULES.md 4.5.1 B 策略
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
 * [NEW] 获取指定标的在指定日期范围内的 EOD 数据
 * 用于 "按标的检查" 功能
 * [UPDATE] 自动触发缺失数据的回填 (5年历史)
 */
export async function getSymbolCloses(
  symbol: string,
  dates: string[]
): Promise<Record<string, OfficialCloseResult>> {
  if (!symbol || dates.length === 0) return {};

  const { firestore, firebaseApp } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};
  const docIds = dates.map(d => `${d}_${symbol}`);
  const colRef = collection(firestore, 'officialCloses');

  // Chunking for Firestore 'in' query limit (10)
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

  // --- Auto Backfill Logic ---
  const missingDates = dates.filter(d => !results[d] || results[d].status !== 'ok');

  if (missingDates.length > 0) {
    const today = getNyToday();
    // Filter out today/future dates
    const historicalMissing = missingDates.filter(d => d < today);

    if (historicalMissing.length > 0) {
      // Find the LATEST missing historical date to trigger the 5-year backfill
      // Sorting desc to get the latest date
      historicalMissing.sort((a, b) => b.localeCompare(a));
      const targetDate = historicalMissing[0];
      const backfillKey = `${targetDate}_${symbol}`;

      if (!pendingBackfills.has(backfillKey)) {
        console.log(`[Repo] Auto-triggering 5-year backfill for ${symbol} based on missing date ${targetDate}`);
        pendingBackfills.add(backfillKey);

        // Mark all missing historical dates as pending in UI immediately
        historicalMissing.forEach(d => {
          if (!results[d]) results[d] = { status: 'pending' };
          else results[d].status = 'pending';
        });

        const functions = getFunctions(firebaseApp, 'us-central1');
        const requestBackfillFn = httpsCallable(functions, 'requestBackfillEod');

        requestBackfillFn({ date: targetDate, symbols: [symbol] })
          .then(() => {
            console.log(`[Repo] Backfill request sent for ${symbol} @ ${targetDate}`);
            setTimeout(() => pendingBackfills.delete(backfillKey), 5000);
          })
          .catch(err => {
            console.error(`[Repo] Backfill request failed for ${symbol}`, err);
            pendingBackfills.delete(backfillKey);
          });

        // Safety timeout
        setTimeout(() => pendingBackfills.delete(backfillKey), 30000);
      } else {
        // Already pending
        historicalMissing.forEach(d => {
          if (!results[d]) results[d] = { status: 'pending' };
          else results[d].status = 'pending';
        });
      }
    }
  }

  return results;
}

/**
 * [NEW] 批量获取指定日期范围内的 EOD 数据 (支持所有标的或过滤标的)
 * 功能：
 * 1. 查询 officialCloses 集合，条件 tradingDate >= startDate 且 tradingDate <= endDate
 * 2. 如果提供了 symbols，则增加 where('symbol', 'in', symbols)
 */
export async function getOfficialClosesRange(
  startDate: string,
  endDate: string,
  symbols?: string[],
  options?: { shouldAutoRequestBackfill?: boolean }
): Promise<Record<string, OfficialCloseResult>> {
  const { firestore } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};
  const colRef = collection(firestore, 'officialCloses');

  try {
    let q;
    if (symbols && symbols.length > 0) {
      // 注意：'in' 查询最多支持 30 个元素。如果 symbols 超过 30，需要分片。
      // 为简化逻辑，这里对 > 30 的情况进行分批查询。
      const chunkedResults: Promise<void>[] = [];
      const chunkSize = 30;

      for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);

        const fetchChunk = async () => {
          try {
            // [Attempt 1] Optimized Composite Query (Requires Index)
            const chunkQuery = query(
              colRef,
              where('tradingDate', '>=', startDate),
              where('tradingDate', '<=', endDate),
              where('symbol', 'in', chunk)
            );

            const snap = await getDocs(chunkQuery);
            processSnapshot(snap, false);
          } catch (err: any) {
            // [Attempt 2] Fallback: Missing Index -> Client-side Filtering
            // Error code 'failed-precondition' typically indicates missing index
            if (err.code === 'failed-precondition' || err.message?.includes('index')) {
              console.warn(`[Repo] Index missing for batch ${i}. Falling back to client-side filtering (slower but robust).`);

              // Query by Symbol ONLY (Uses default index)
              const fallbackQuery = query(
                colRef,
                where('symbol', 'in', chunk)
              );

              const snap = await getDocs(fallbackQuery);
              processSnapshot(snap, true);
            } else {
              console.error(`[Repo] Chunk fetch failed for symbols: ${chunk.join(', ')}`, err);
              throw err; // Re-throw other errors
            }
          }
        };

        // Helper to process results
        const processSnapshot = (snap: any, needsDateFilter: boolean) => {
          snap.forEach((d: any) => {
            const data = d.data();

            // Client-side Date Filter (for Fallback)
            if (needsDateFilter) {
              if (!data.tradingDate || data.tradingDate < startDate || data.tradingDate > endDate) {
                return;
              }
            }

            if (data.symbol && data.tradingDate) {
              results[d.id] = {
                status: data.status === 'ok' ? 'ok' : 'error',
                close: data.close,
                tradingDate: data.tradingDate,
                provider: data.provider
              };
              // Update Cache
              resultCache.set(d.id, results[d.id]);
            }
          });
        };

        chunkedResults.push(fetchChunk());
      }

      await Promise.all(chunkedResults);

    } else {
      // 没指定 symbols，拉取该时间段的所有数据 (慎用，可能数据量大)
      q = query(
        colRef,
        where('tradingDate', '>=', startDate),
        where('tradingDate', '<=', endDate)
      );
      const snap = await getDocs(q);
      snap.forEach(d => {
        const data = d.data();
        if (data.symbol && data.tradingDate) {
          results[d.id] = {
            status: data.status === 'ok' ? 'ok' : 'error',
            close: data.close,
            tradingDate: data.tradingDate,
            provider: data.provider
          };
          resultCache.set(d.id, results[d.id]);
        }
      });
    }

  } catch (e) {
    console.error("[Repo] Failed to fetch range closes", e);
  }

  // --- 4. Auto Backfill Logic (Range) ---
  if (options?.shouldAutoRequestBackfill && symbols && symbols.length > 0) {
    const today = getNyToday();
    const missingMap = new Map<string, string>(); // symbol -> latestMissingDate

    // Naive iteration from endDate down to startDate to find LATEST missing date
    // We construct a Date loop.
    let curr = new Date(endDate + 'T12:00:00Z'); // Noon UTC to avoid timezone issues
    const startDt = new Date(startDate + 'T12:00:00Z');

    // Safety brake: don't loop more than 366 days
    let loops = 0;
    while (curr >= startDt && loops < 370) {
      loops++;
      const dStr = toNyCalendarDayString(curr);

      // We only backfill history (yesterday or older) and only Valid Trading Days.
      // Skipping weekends/holidays prevents useless spam to backend.
      if (dStr < today && isNyTradingDay(dStr)) {
        for (const sym of symbols) {
          // If we already found a missing date for this symbol, skip (we only need one trigger)
          if (missingMap.has(sym)) continue;

          // Check if data exists in results
          // Note: results uses IDs (usually "YYYY-MM-DD_SYMBOL")
          // If getOfficialClosesRange results are populated by ID, we construct ID to check.
          const key = `${dStr}_${sym}`;
          const res = results[key];

          if (!res || res.status === 'missing' || res.status === 'error') {
            missingMap.set(sym, dStr);

            // Inject pending status visually so UI reacts immediately
            if (!results[key]) results[key] = { status: 'pending' };
            else results[key].status = 'pending';

            resultCache.set(key, results[key]);
          }
        }
      }

      // If we found missing dates for ALL symbols, we can stop the loop early
      if (missingMap.size === symbols.length) break;

      // Decrement day
      curr.setDate(curr.getDate() - 1);
    }

    // Trigger Backfills
    if (missingMap.size > 0) {
      const { firebaseApp } = initializeFirebase();
      const functions = getFunctions(firebaseApp, 'us-central1');
      const requestBackfillFn = httpsCallable(functions, 'requestBackfillEod');

      const entries = Array.from(missingMap.entries());
      console.log(`[Repo] Range Check: Found ${entries.length} symbols with missing history. Triggering backfills...`);

      // Use pendingBackfills set to deduplicate
      const requestsToFire: { date: string, symbol: string }[] = [];

      entries.forEach(([sym, date]) => {
        const key = `${date}_${sym}`;
        if (!pendingBackfills.has(key)) {
          pendingBackfills.add(key);
          requestsToFire.push({ date, symbol: sym });
        } else {
          // Already pending, just ensuring 'pending' status is set (already done above)
        }
      });

      // Fire requests (Batching by Date if possible? Backend Backfill is (date, symbols[]))
      // Let's group by Date to minimize calls
      const byDate = new Map<string, string[]>();
      requestsToFire.forEach(r => {
        const list = byDate.get(r.date) || [];
        list.push(r.symbol);
        byDate.set(r.date, list);
      });

      for (const [date, syms] of byDate.entries()) {
        console.log(`[Repo] Auto-Backfilling Range: ${date} for ${syms.length} symbols: ${syms.join(', ')}`);
        requestBackfillFn({ date, symbols: syms })
          .then(() => {
            setTimeout(() => {
              syms.forEach(s => pendingBackfills.delete(`${date}_${s}`));
            }, 5000);
          })
          .catch(err => {
            console.error(`[Repo] Backfill failed for ${date}`, err);
            syms.forEach(s => pendingBackfills.delete(`${date}_${s}`));
          });

        // Safety timeout
        setTimeout(() => {
          syms.forEach(s => pendingBackfills.delete(`${date}_${s}`));
        }, 30000);
      }
    }
  }

  return results;
}

/**
 * [NEW] 批量获取指定日期和标的的 EOD 数据 (By ID)
 * 坚固模式：不依赖复合索引，通过 documentId 直接查询。
 * 适用于 MTD 等短周期、高确定性的数据获取。
 */
export async function getOfficialClosesBatch(
  dates: string[],
  symbols: string[]
): Promise<Record<string, OfficialCloseResult>> {
  if (!dates.length || !symbols.length) return {};

  const { firestore } = initializeFirebase();
  const results: Record<string, OfficialCloseResult> = {};
  const colRef = collection(firestore, 'officialCloses');

  // 1. Generate All Target IDs
  const allIds: string[] = [];
  for (const date of dates) {
    for (const sym of symbols) {
      allIds.push(`${date}_${sym}`);
    }
  }

  // 2. Chunking (max 30 for 'in' query on documentId)
  const chunks: string[][] = [];
  const chunkSize = 30;
  for (let i = 0; i < allIds.length; i += chunkSize) {
    chunks.push(allIds.slice(i, i + chunkSize));
  }

  try {
    const promises = chunks.map(chunk => {
      // documentId() in [...] is very efficient and requires no index
      const q = query(colRef, where(documentId(), 'in', chunk));
      return getDocs(q);
    });

    const snapshots = await Promise.all(promises);

    snapshots.forEach(snap => {
      snap.forEach(d => {
        const data = d.data();
        if (data.symbol) {
          results[d.id] = {
            status: data.status === 'ok' ? 'ok' : 'error',
            close: data.close,
            tradingDate: data.tradingDate || d.id.split('_')[0],
            provider: data.provider
          };
          // Use the file-scope resultCache
          resultCache.set(d.id, results[d.id]);
        }
      });
    });

  } catch (e) {
    console.error("[Repo] Failed to fetch batch closes", e);
  }

  return results;
}

/**
 * Manually trigger backfill for missing EOD data.
 * Exposed for UI "Fix Now" buttons.
 */
export async function triggerManualBackfill(date: string, symbols: string[]): Promise<void> {
  if (!symbols || symbols.length === 0) return;

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
    // Auto-clear pending after short delay to allow re-try if needed
    setTimeout(() => {
      actualSymbols.forEach(s => pendingBackfills.delete(`${date}_${s}`));
    }, 5000);
  } catch (err) {
    console.error(`[Repo] Manual Backfill failed for ${date}`, err);
    actualSymbols.forEach(s => pendingBackfills.delete(`${date}_${s}`));
    throw err;
  }
}