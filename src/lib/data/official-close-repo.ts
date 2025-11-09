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

// ---- main API ----
export async function getMany(
  date: string,
  symbols: string[],
  opts?: { shouldAutoRequestBackfill?: boolean }
): Promise<Record<string, OfficialCloseResult>> {
  const results: Record<string, OfficialCloseResult> = {};
  const uniqSymbols = Array.from(new Set((symbols ?? []).filter(Boolean)));
  if (uniqSymbols.length === 0) return results;

  // 1) Firestore 命中（按 30 一批）
  try {
    const db = getDb();
    const ids = uniqSymbols.map((s) => `${date}_${s}`);
    for (const idChunk of chunk(ids, 30)) {
      const q = query(
        collection(db, "officialCloses"),
        where("__name__", "in", idChunk)
      );
      const snapshot = await getDocs(q);
      snapshot.forEach((d) => {
        const sep = d.id.indexOf("_");
        const symbol = sep >= 0 ? d.id.slice(sep + 1) : d.id;

        const raw: any = d.data() ?? {};
        const close =
          typeof raw?.close === "number" && Number.isFinite(raw.close)
            ? raw.close
            : undefined;

        const retrievedAt: string | undefined = raw?.retrievedAt?.toDate
          ? raw.retrievedAt.toDate().toISOString()
          : typeof raw?.retrievedAt === "string"
          ? raw.retrievedAt
          : undefined;

        // 注意顺序：先铺字段，最后给 status 默认值，避免被 undefined 覆盖
        results[symbol] = {
          close,
          currency: raw?.currency,
          provider: raw?.provider,
          tz: raw?.tz,
          retrievedAt,
          hint: undefined,
          status: raw?.status ?? "ok",
        };
      });
    }
  } catch (err: any) {
    // 读取出错：将尚未有结果的符号标为 error（避免崩溃）
    for (const s of uniqSymbols) {
      if (!results[s]) {
        results[s] = {
          status: "error",
          hint:
            (err?.code === "permission-denied" && "firestore_permission_denied") ||
            "firestore_read_error",
        };
      }
    }
  }

  // 2) 标记缺失
  const missingSymbols: string[] = [];
  for (const s of uniqSymbols) {
    if (!results[s]) {
      results[s] = { status: "missing", hint: "Data not found in cache." };
      missingSymbols.push(s);
    }
  }

  // 3)（可选）同步逐批触发回填
  if (opts?.shouldAutoRequestBackfill && missingSymbols.length > 0) {
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
          if (i === 0) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }

      if (success) {
        batch.forEach((s) => {
          // 保留已有字段，仅更新状态与 hint
          results[s] = {
            ...results[s],
            status: "pending",
            hint: "Backfill request initiated.",
          };
        });
      } else {
        console.warn("[official-close-repo] Failed to queue backfill batch", {
          date,
          batchSize: batch.length,
          error: (lastError as any)?.message ?? lastError,
        });
        batch.forEach((s) => {
          results[s] = { status: "error", hint: "backfill_request_failed" };
        });
      }
    }
  }

  return results;
}
