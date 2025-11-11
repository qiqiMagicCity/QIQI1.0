// src/lib/data/official-close-repo.ts
import { getApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

export type OfficialCloseResult = {
  status: "ok" | "missing" | "pending" | "error";
  close?: number;
  currency?: string;
  provider?: string;
  tz?: string;
  retrievedAt?: string; // ISO string if present
  hint?: string;
};

const MAX_BACKFILL_PER_CALL = 50;
// Firestore `in` 查询一次最多 10 个 id
const ID_CHUNK_LIMIT = 10;

// ===== 内存缓存（安全版，不会挂起）=====
type CacheVal = { value: OfficialCloseResult; ts: number };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟 TTL
// key = `${date}_${symbol}`
const EOD_CACHE = new Map<string, CacheVal>();

// ---- lazy getters（禁止在模块顶层拿 app/db/fns）----
function ensureApp() {
  if (getApps().length === 0) {
    // 统一由 client-provider 初始化；这里仅做防卫
    throw new Error(
      "[official-close-repo] Firebase app not initialized. Call initializeApp() in client-provider before using getMany()."
    );
  }
  return getApp();
}

function getDb() {
  const app = ensureApp();
  return getFirestore(app);
}

function getRequestBackfillEod() {
  const app = ensureApp();
  // 显式 region，避免默认区域不一致
  const fns = getFunctions(app, "us-central1");
  return httpsCallable<{ date: string; symbols: string[] }, unknown>(
    fns,
    "requestBackfillEod"
  );
}

// ---- utils ----
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isFiniteNumber(v: any): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toIso(ts: any): string | undefined {
  // Firestore Timestamp
  if (ts && typeof ts === "object" && typeof ts.toDate === "function") {
    try {
      return ts.toDate().toISOString();
    } catch {
      /* noop */
    }
  }
  if (typeof ts === "string") return ts;
  return undefined;
}

type NormalizedDoc =
  | (OfficialCloseResult & { status: "ok"; close: number })
  | OfficialCloseResult
  | undefined;

/**
 * 顶层优先；若顶层缺失/不合规，则从 attempts 里挑“最后一个有效尝试”
 * （status==='ok' 且 close 为有限数值）扁平化返回。
 * 仅当能得到有效 close 时才返回 {status:'ok', close,...}；
 * 否则返回 undefined 交由上层标记 error/missing。
 */
function normalizeEodDoc(raw: any): NormalizedDoc {
  if (!raw || typeof raw !== "object") return undefined;

  const topStatus = typeof raw.status === "string" ? (raw.status as string) : undefined;
  const topClose = isFiniteNumber(raw.close) ? (raw.close as number) : undefined;

  // 顶层：若有数值 close，且（status 为 'ok' 或未提供但可视为 ok）
  if (topClose != null && (topStatus === "ok" || topStatus == null)) {
    return {
      status: "ok",
      close: topClose,
      currency: raw.currency,
      provider: raw.provider,
      tz: raw.tz,
      retrievedAt: toIso(raw.retrievedAt),
    };
  }

  // 尝试从 attempts 兜底
  const attempts = raw.attempts;
  const pickFromAttempt = (a: any): NormalizedDoc => {
    if (!a || typeof a !== "object") return undefined;
    const st = typeof a.status === "string" ? (a.status as string) : undefined;
    const cl = isFiniteNumber(a.close) ? (a.close as number) : undefined;
    if (st === "ok" && cl != null) {
      return {
        status: "ok",
        close: cl,
        currency: a.currency ?? raw.currency,
        provider: a.provider ?? raw.provider,
        tz: a.tz ?? raw.tz,
        retrievedAt: toIso(a.retrievedAt) ?? toIso(raw.retrievedAt),
      };
    }
    return undefined;
  };

  if (Array.isArray(attempts) && attempts.length > 0) {
    // 从后往前挑最后一个有效 'ok'
    for (let i = attempts.length - 1; i >= 0; i--) {
      const picked = pickFromAttempt(attempts[i]);
      if (picked) return picked;
    }
  } else if (attempts && typeof attempts === "object") {
    const picked = pickFromAttempt(attempts);
    if (picked) return picked;
  }

  // 顶层若声明了 error/pending 之类，这里不强行改写
  if (topStatus && topStatus !== "ok") {
    return {
      status: "error",
      hint: `top_level_status_${topStatus}`,
    };
  }

  return undefined;
}

function cacheGet(id: string): OfficialCloseResult | undefined {
  const hit = EOD_CACHE.get(id);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    EOD_CACHE.delete(id);
    return undefined;
  }
  return hit.value;
}

function cacheSet(id: string, value: OfficialCloseResult) {
  EOD_CACHE.set(id, { value, ts: Date.now() });
}

// ---- main API ----
export async function getMany(
  date: string,
  symbols: string[],
  opts?: { shouldAutoRequestBackfill?: boolean }
): Promise<Record<string, OfficialCloseResult>> {
  const results: Record<string, OfficialCloseResult> = {};
  const uniqSymbols = Array.from(new Set((symbols ?? []).filter(Boolean)));
  if (uniqSymbols.length === 0) return results;

  const shouldAutoRequestBackfill = opts?.shouldAutoRequestBackfill ?? true;

  // 0) 命中缓存的先返回
  const toFetch: string[] = [];
  for (const s of uniqSymbols) {
    const id = `${date}_${s}`;
    const cached = cacheGet(id);
    if (cached) {
      results[s] = cached;
    } else {
      toFetch.push(s);
    }
  }
  if (toFetch.length === 0) return results;

  // 1) Firestore 命中（按 10 一批，避免 in 限制）
  try {
    const db = getDb();
    const ids = toFetch.map((s) => `${date}_${s}`);

    // 先把“可能缺失”的都准备成 missing（防止任何情况下悬挂）
    // 注意：等会儿读到文档就会覆写成 ok/error
    for (const s of toFetch) {
      if (!results[s]) {
        results[s] = { status: "missing", hint: "Data not found in cache." };
      }
    }

    for (const idChunk of chunk(ids, ID_CHUNK_LIMIT)) {
      const q = query(collection(db, "officialCloses"), where("__name__", "in", idChunk));
      const snapshot = await getDocs(q);

      // 标记本批次中实际命中的 id
      const hitIds = new Set<string>();

      snapshot.forEach((d) => {
        hitIds.add(d.id);

        const sep = d.id.indexOf("_");
        const symbol = sep >= 0 ? d.id.slice(sep + 1) : d.id;

        const raw: any = d.data() ?? {};
        const normalized = normalizeEodDoc(raw);

        if (normalized && normalized.status === "ok" && isFiniteNumber(normalized.close)) {
          results[symbol] = normalized;
          cacheSet(`${date}_${symbol}`, normalized);
        } else if (raw && typeof raw === "object") {
          const val: OfficialCloseResult = { status: "error", hint: "invalid_eod_doc" };
          results[symbol] = val;
          cacheSet(`${date}_${symbol}`, val);
        }
      });

      // 这批里没命中的 id → 确认 missing（并入缓存，防止重复查）
      for (const id of idChunk) {
        if (!hitIds.has(id)) {
          const sep = id.indexOf("_");
          const symbol = sep >= 0 ? id.slice(sep + 1) : id;
          const val: OfficialCloseResult = { status: "missing", hint: "Data not found in cache." };
          results[symbol] = val;
          cacheSet(id, val);
        }
      }
    }
  } catch (err: any) {
    // 读取出错：将尚未有结果的符号标为 error（避免崩溃/悬挂），并入缓存
    for (const s of toFetch) {
      if (!results[s] || results[s].status === "missing") {
        const val: OfficialCloseResult = {
          status: "error",
          hint:
            (err?.code === "permission-denied" && "firestore_permission_denied") ||
            "firestore_read_error",
        };
        results[s] = val;
        cacheSet(`${date}_${s}`, val);
      }
    }
  }

  // 2)（可选）同步逐批触发回填（仅针对 missing 符号）
  if (shouldAutoRequestBackfill) {
    const missingSymbols: string[] = [];
    for (const s of uniqSymbols) {
      if (results[s]?.status === "missing") missingSymbols.push(s);
    }

    if (missingSymbols.length > 0) {
      const call = getRequestBackfillEod();
      for (const batch of chunk(missingSymbols, MAX_BACKFILL_PER_CALL)) {
        let success = false;
        let lastError: unknown = null;

        for (let i = 0; i < 2; i++) {
          try {
            await call({ date, symbols: batch });
            success = true;
            break;
          } catch (e) {
            lastError = e;
            if (i === 0) await new Promise((r) => setTimeout(r, 300));
          }
        }

        if (success) {
          batch.forEach((s) => {
            const val: OfficialCloseResult = {
              ...(results[s] ?? {}),
              status: "pending",
              hint: "Backfill request initiated.",
            };
            results[s] = val;
            cacheSet(`${date}_${s}`, val);
          });
        } else {
          console.warn("[official-close-repo] Failed to queue backfill batch", {
            date,
            batchSize: batch.length,
            error: (lastError as any)?.message ?? lastError,
          });
          batch.forEach((s) => {
            const val: OfficialCloseResult = { status: "error", hint: "backfill_request_failed" };
            results[s] = val;
            cacheSet(`${date}_${s}`, val);
          });
        }
      }
    }
  }

  return results;
}
