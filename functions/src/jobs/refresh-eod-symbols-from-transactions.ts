// functions/src/jobs/refresh-eod-symbols-from-transactions.ts
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

// —— 小工具：后端统一的 symbol（标的代码）归一化逻辑 ——
// 和 index.ts 里的 normalizeSymbolForServer 保持同一逻辑，
// 但这里单独实现一份，避免产生循环依赖。
function normalizeSymbolForServer(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * 内核：真正执行“从交易记录刷新 EOD 标的列表”的逻辑。
 *
 * - 扫描所有 users/{uid}/transactions（交易记录集合）；
 * - 收集 symbol 字段，做归一化 + 去重 + 排序；
 * - 写回 meta/eodSymbols/eodSymbols.list；
 * - 返回扫描条数和最终 symbol 列表，方便外层封装获取结果。
 */
async function runRefreshEodSymbolsCore(): Promise<{
  scannedCount: number;
  symbols: string[];
}> {
  const db = admin.firestore();

  logger.info("[refreshEodSymbols] core job started", {
    timestamp: new Date().toISOString(),
  });

  // 1) 扫描所有 users/{uid}/transactions，收集 symbol
  const symbolSet = new Set<string>();
  let scannedCount = 0;

  const snapshot = await db
    .collectionGroup("transactions")
    .select("symbol")
    .get();

  snapshot.forEach((doc) => {
    scannedCount += 1;
    const raw = doc.get("symbol") as unknown;
    const norm = normalizeSymbolForServer(raw);
    if (!norm) return; // 空字符串直接丢弃
    symbolSet.add(norm);
  });

  const symbols = Array.from(symbolSet).sort();

  logger.info("[refreshEodSymbols] collected symbols", {
    scannedTransactionDocs: scannedCount,
    uniqueSymbols: symbols.length,
  });

  // 2) 回写到 meta/eodSymbols/eodSymbols.list
  const metaDocRef = db.collection("meta").doc("eodSymbols");

  await metaDocRef.set(
    {
      list: symbols,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "transactions_collectionGroup",
    },
    { merge: true }
  );

  logger.info("[refreshEodSymbols] meta/eodSymbols.list updated", {
    uniqueSymbols: symbols.length,
  });

  return { scannedCount, symbols };
}

/**
 * 定时任务版本：每天 NY（New York 纽约）时间 15:45 自动跑一遍，
 * 给 EOD（日终收盘价）管道准备好 symbol 列表。
 */
export const refreshEodSymbolsFromTransactions = onSchedule(
  {
    schedule: "45 15 * * *", // 每天 15:45 America/New_York
    timeZone: "America/New_York",
    timeoutSeconds: 540,
  },
  async () => {
    await runRefreshEodSymbolsCore();
  }
);

/**
 * 按需触发版本（HTTP onRequest）：
 *
 * 方便从终端用 curl 手动执行刷新，顺便拿到结果：
 * - scannedTransactionDocs：本次扫描了多少条交易记录；
 * - uniqueSymbols：最终有多少只标的；
 * - sample：前若干只 symbol 样本，方便你确认。
 *
 * 调用方式示例（PowerShell 里）：
 * curl "https://us-central1-<你的项目ID>.cloudfunctions.net/refreshEodSymbolsFromTransactionsOnDemand"
 */
export const refreshEodSymbolsFromTransactionsOnDemand = onRequest(
  async (req, res) => {
    // 简单限制：只允许 GET / POST，两者都返回同样结果
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const { scannedCount, symbols } = await runRefreshEodSymbolsCore();

      res.json({
        ok: true,
        scannedTransactionDocs: scannedCount,
        uniqueSymbols: symbols.length,
        sample: symbols.slice(0, 20),
      });
    } catch (err) {
      logger.error(
        "[refreshEodSymbolsOnDemand] error while refreshing symbols",
        err
      );
      res.status(500).json({
        ok: false,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
);