// src/lib/data/official-close-repo.ts
import {
  getFirestore,
  getDocs,
  collection,
  query,
  where,
  documentId,
  doc,
  setDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { initializeFirebase } from '@/firebase'; // 确保这个路径指向 src/firebase/index.ts
import { toNyCalendarDayString } from '@/lib/ny-time';

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