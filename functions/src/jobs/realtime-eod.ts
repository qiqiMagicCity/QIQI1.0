// functions/src/jobs/realtime-eod.ts
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

// --- 辅助工具：获取 NY 时间 YYYY-MM-DD ---
const nyTodayYmd = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * 判断是否为交易日 (符合 v0.2 规则 2.2)
 * 读取 meta/marketHolidays
 */
async function isNyTradingDay(
  db: admin.firestore.Firestore,
  dateYmd: string,
): Promise<boolean> {
  const docRef = db.collection("meta").doc("marketHolidays");
  const snap = await docRef.get();

  if (!snap.exists) {
    logger.error(
      "[realtimeEod] meta/marketHolidays missing, fail-safe to false",
      { date: dateYmd },
    );
    return false;
  }

  const data = snap.data() as any;
  const rawList: unknown[] = Array.isArray(data?.list)
    ? (data.list as unknown[])
    : Array.isArray(data?.holidays)
      ? (data.holidays as unknown[])
      : [];

  const holidaySet = new Set(
    rawList
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return !holidaySet.has(dateYmd);
}

/**
 * 读取 EOD 目标标的列表
 */
async function loadEodSymbols(db: admin.firestore.Firestore): Promise<string[]> {
  const docRef = db.collection("meta").doc("eodSymbols");
  const snap = await docRef.get();
  if (!snap.exists) return [];

  const data = snap.data() as any;
  const rawList = Array.isArray(data?.list) ? data.list : [];

  return Array.from(
    new Set(
      rawList
        .filter((s: any) => typeof s === "string")
        .map((s: string) => s.toUpperCase().trim())
        .filter(Boolean),
    ),
  );
}

/**
 * 执行单次 Pass
 * 核心逻辑遵循 v0.2 规则 9.1：
 * 1. 检查是否已存在 -> 存在则跳过 (幂等)
 * 2. 不存在 -> 从 stockDetails 拿 last 写入
 */
async function runRealtimeEodPass(passLabel: string) {
  const db = admin.firestore();
  const date = nyTodayYmd(); // 纽约交易日 YYYY-MM-DD

  // 1. 交易日检查
  const isTradingDay = await isNyTradingDay(db, date);
  if (!isTradingDay) {
    logger.info(
      `[realtimeEod] ${passLabel} skip: non-trading day`,
      { date },
    );
    return;
  }

  // 2. 加载标的
  const symbols = await loadEodSymbols(db);
  if (symbols.length === 0) return;

  logger.info(
    `[realtimeEod] ${passLabel} start`,
    { date, count: symbols.length },
  );

  const batch = db.batch();
  let writeCount = 0;
  let skipExistCount = 0;

  // 3. 批量处理
  // 注意：为了性能，这里是并发读，但 batch（批量）写。
  // 如果 symbols 很多 (>500)，建议分片。此处假设 <500。
  const refs = symbols.map((sym) => ({
    sym,
    eodRef: db
      .collection("officialCloses")
      .doc(`${date}_${sym}`),
    stockRef: db.collection("stockDetails").doc(sym),
  }));

  // 并行检查 EOD 是否已存在
  const eodSnaps = await db.getAll(...refs.map((r) => r.eodRef));

  // 过滤出还不存在的标的
  // 过滤出需要写入的标的：
  // 1. 文档不存在 -> 写
  // 2. 文档存在但 status != 'ok' (例如 error/missing) -> 覆盖写
  // 3. 文档存在且 status == 'ok' -> 跳过
  const targetIndices = eodSnaps
    .map((snap, idx) => {
      if (!snap.exists) return idx;
      const data = snap.data();
      if (data?.status === "ok") return -1; // 只有 ok 才真正跳过
      return idx; // 其他情况（如 error）允许覆盖
    })
    .filter((i) => i !== -1);

  skipExistCount = symbols.length - targetIndices.length;

  if (targetIndices.length === 0) {
    logger.info(
      `[realtimeEod] ${passLabel} all done, nothing to write.`,
      { date },
    );
    return;
  }

  // 只读取需要写入的 stockDetails
  const targetRefs = targetIndices.map((i) => refs[i]);
  const stockSnaps = await db.getAll(
    ...targetRefs.map((r) => r.stockRef),
  );

  for (let i = 0; i < targetRefs.length; i++) {
    const { sym, eodRef } = targetRefs[i];
    const stockSnap = stockSnaps[i];

    if (!stockSnap.exists) continue;

    const sData = stockSnap.data() as any;
    const last = sData?.last;
    const ts = sData?.ts; // timestamp in ms

    // 校验价格有效性 + 新鲜度校验 (防止写入昨日旧价格)
    if (typeof last === "number" && Number.isFinite(last)) {
      // 检查 ts 是否属于当前交易日 date
      // 注意：ts 是 UTC 时间戳，date 是 NY YYYY-MM-DD
      // 我们需要把 ts 转为 NY YYYY-MM-DD 进行比对
      let isFresh = false;
      if (typeof ts === 'number') {
        const tsDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(ts));
        if (tsDate === date) {
          isFresh = true;
        }
      }

      if (!isFresh) {
        logger.warn(`[realtimeEod] ${passLabel} skip stale data`, { sym, date, ts, last });
        continue;
      }

      batch.set(eodRef, {
        status: "ok",
        close: last,
        currency: "USD",
        provider: "realtime", // 来源标识：实时价
        source: "stockDetails",
        symbol: sym,
        tradingDate: date,     // 统一字段名（纽约交易日）
        date: date,            // 兼容旧字段，与 run.ts 保持一致
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        pass: passLabel,       // 审计字段
      });
      writeCount++;
    }
  }

  if (writeCount > 0) {
    await batch.commit();
  }

  logger.info(
    `[realtimeEod] ${passLabel} finished`,
    {
      date,
      writeCount,
      skipExistCount,
    },
  );
}

// --- 调度入口 (Pass 1-5) ---
// 遵循 9.1 规则：16:01 - 16:05 每分钟一次（纽约时间）

export const realtimeEodPass1 = onSchedule(
  { schedule: "1 16 * * 1-5", timeZone: "America/New_York" },
  async () => runRealtimeEodPass("pass1"),
);

export const realtimeEodPass2 = onSchedule(
  { schedule: "2 16 * * 1-5", timeZone: "America/New_York" },
  async () => runRealtimeEodPass("pass2"),
);

export const realtimeEodPass3 = onSchedule(
  { schedule: "3 16 * * 1-5", timeZone: "America/New_York" },
  async () => runRealtimeEodPass("pass3"),
);

export const realtimeEodPass4 = onSchedule(
  { schedule: "4 16 * * 1-5", timeZone: "America/New_York" },
  async () => runRealtimeEodPass("pass4"),
);

export const realtimeEodPass5 = onSchedule(
  { schedule: "5 16 * * 1-5", timeZone: "America/New_York" },
  async () => runRealtimeEodPass("pass5"),
);
