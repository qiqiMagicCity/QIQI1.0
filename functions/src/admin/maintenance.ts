import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { runCloseForSymbols } from "../lib/close/run";

// Secrets
const FMP_TOKEN = defineSecret("FMP_TOKEN");
const POLYGON_TOKEN = defineSecret("POLYGON_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

// 辅助：获取 NY 时间
const nyTodayYmd = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * 维护工具箱 (HTTP Request)
 * 部署后访问: 
 * 按日期清理: URL?action=cleanup&date=2025-11-18
 * 全局清理Error: URL?action=cleanup_all_errors
 * 演习: URL?action=force_realtime
 * 历史回填: URL?action=backfill_history&date=2025-11-18
 */
export const maintenanceTool = onRequest(
  { secrets: [FMP_TOKEN, POLYGON_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY] },
  async (req, res) => {
    const action = req.query.action as string;
    const db = admin.firestore();

    try {
      // --- 功能 A: 按日期清理 (Cleanup by Date) ---
      if (action === "cleanup") {
        const targetDate = (req.query.date as string) || nyTodayYmd();
        const force = req.query.force === "true"; // 新增：强制清理模式

        logger.info(`[Maintenance] Starting cleanup for ${targetDate} (force=${force})...`);

        const batch = db.batch();
        let count = 0;
        const deletedIds = new Set<string>(); // 防止重复删除

        // 1. 扫描旧字段 "date"
        let queryLegacy = db.collection("officialCloses").where("date", "==", targetDate);
        if (!force) {
          queryLegacy = queryLegacy.where("status", "==", "error");
        }
        const snapLegacy = await queryLegacy.get();

        snapLegacy.docs.forEach(doc => {
          if (!deletedIds.has(doc.id)) {
            batch.delete(doc.ref);
            deletedIds.add(doc.id);
            count++;
          }
        });

        // 2. 扫描新字段 "tradingDate"
        let queryNew = db.collection("officialCloses").where("tradingDate", "==", targetDate);
        if (!force) {
          queryNew = queryNew.where("status", "==", "error");
        }
        const snapNew = await queryNew.get();

        snapNew.docs.forEach(doc => {
          if (!deletedIds.has(doc.id)) {
            batch.delete(doc.ref);
            deletedIds.add(doc.id);
            count++;
          }
        });

        if (count > 0) {
          await batch.commit();
        }

        res.json({
          message: count > 0 ? "清理成功！垃圾已删除。" : `未发现 ${targetDate} 的错误数据。`,
          deletedCount: count,
          targetDate,
          scannedLegacy: snapLegacy.size,
          scannedNew: snapNew.size
        });
        return;
      }

      // --- 功能 C: 全局清理所有 Error (Global Cleanup) ---
      if (action === "cleanup_all_errors") {
        logger.info("[Maintenance] Starting GLOBAL cleanup for status='error'...");

        // 1. 查询所有 status=error
        const snapshot = await db.collection("officialCloses")
          .where("status", "==", "error")
          .get();

        if (snapshot.empty) {
          res.json({ message: "恭喜！系统中没有任何 status='error' 的脏数据。" });
          return;
        }

        // 2. 分批删除 (Firestore Batch 限制 500)
        const total = snapshot.size;
        let deletedCount = 0;
        const batches: Promise<any>[] = [];
        let currentBatch = db.batch();
        let opCount = 0;

        snapshot.docs.forEach((doc) => {
          currentBatch.delete(doc.ref);
          opCount++;
          deletedCount++;

          if (opCount >= 450) { // 安全起见用 450
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
            opCount = 0;
          }
        });

        if (opCount > 0) {
          batches.push(currentBatch.commit());
        }

        await Promise.all(batches);

        res.json({
          message: `全局清理完成！共删除了 ${deletedCount} 条错误数据。`,
          deletedCount
        });
        return;
      }

      // --- 功能 B: 强制触发实时定盘 (演习) ---
      if (action === "force_realtime") {
        const date = nyTodayYmd();
        const metaSnap = await db.collection("meta").doc("eodSymbols").get();
        const rawList = metaSnap.exists ? metaSnap.data()?.list : [];
        const symbols: string[] = Array.isArray(rawList) ? rawList : [];

        if (symbols.length === 0) {
          res.json({ error: "meta/eodSymbols 列表为空，无法执行。" });
          return;
        }

        const batch = db.batch();
        let successCount = 0;

        for (const sym of symbols) {
          const upper = sym.toUpperCase().trim();
          const stockSnap = await db.collection("stockDetails").doc(upper).get();
          if (!stockSnap.exists) continue;

          const last = stockSnap.data()?.last;
          if (typeof last === "number") {
            const docRef = db.collection("officialCloses").doc(`${date}_${upper}`);
            batch.set(docRef, {
              status: "ok",
              close: last,
              currency: "USD",
              provider: "realtime",
              source: "manual_force_test",
              symbol: upper,
              date: date, // 兼容旧字段
              tradingDate: date,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            successCount++;
          }
        }

        if (successCount > 0) await batch.commit();
        res.json({ message: "演习结束。", date, successCount });
        return;
      }

      // --- 功能 D: 历史回填 (Backfill History) ---
      if (action === "backfill_history") {
        const date = req.query.date as string;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          res.status(400).json({ error: "必须提供有效的 date 参数 (YYYY-MM-DD)" });
          return;
        }

        const today = nyTodayYmd();
        if (date >= today) {
          res.status(400).json({ error: "只能回填历史日期 (< today)。今日数据请用 force_realtime。" });
          return;
        }

        // 1. 获取标的列表
        let symbols: string[] = [];
        if (req.query.symbol) {
          symbols = [(req.query.symbol as string).toUpperCase().trim()];
        } else {
          const metaSnap = await db.collection("meta").doc("eodSymbols").get();
          const rawList = metaSnap.exists ? metaSnap.data()?.list : [];
          symbols = Array.isArray(rawList) ? rawList : [];
        }

        if (symbols.length === 0) {
          res.json({ error: "没有找到需要回填的标的。" });
          return;
        }

        logger.info(`[Maintenance] Starting backfill for ${date}, symbols: ${symbols.length}`);

        // 2. 准备 Secrets
        const secrets = {
          FMP_TOKEN: FMP_TOKEN.value() || "",
          POLYGON_TOKEN: POLYGON_TOKEN.value() || "",
          MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
          STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
        };

        // 3. 调用核心逻辑
        const results = await runCloseForSymbols(db, date, symbols, secrets);

        res.json({
          message: `回填完成。日期: ${date}`,
          count: Object.keys(results).length,
          results
        });
        return;
      }

      // --- 功能 E: 手动补录 (Manual Write) ---
      if (action === "manual_write_eod") {
        const date = req.query.date as string;
        const symbol = (req.query.symbol as string || "").toUpperCase().trim();
        const closeStr = req.query.close as string;

        if (!date || !symbol || !closeStr) {
          res.status(400).json({ error: "参数缺失: date, symbol, close 都是必填项" });
          return;
        }
        const close = parseFloat(closeStr);
        if (isNaN(close)) {
          res.status(400).json({ error: "close 必须是数字" });
          return;
        }

        const docId = `${date}_${symbol}`;
        await db.collection("officialCloses").doc(docId).set({
          status: "ok",
          close: close,
          currency: "USD",
          provider: "manual",
          source: "manual_fix",
          symbol: symbol,
          date: date,
          tradingDate: date,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.json({ message: "补录成功", docId, close });
        return;
      }

      // --- 功能 F: 检查缺失 (Check Missing) ---
      if (action === "check_missing") {
        const date = (req.query.date as string) || nyTodayYmd();

        // 1. 获取应有的标的列表
        const metaSnap = await db.collection("meta").doc("eodSymbols").get();
        const allSymbols: string[] = metaSnap.exists ? (metaSnap.data()?.list || []) : [];

        if (allSymbols.length === 0) {
          res.json({ message: "meta/eodSymbols 列表为空" });
          return;
        }

        // 2. 查询该日期下已有的 OK 数据
        const snapshot = await db.collection("officialCloses")
          .where("tradingDate", "==", date)
          .where("status", "==", "ok")
          .get();

        const existingSet = new Set<string>();
        snapshot.docs.forEach(d => {
          const s = d.data().symbol;
          if (s) existingSet.add(s);
        });

        // 3. 对比找出缺失的
        const missing = allSymbols.filter(s => !existingSet.has(s));

        res.json({
          date,
          totalSymbols: allSymbols.length,
          foundOk: existingSet.size,
          missingCount: missing.length,
          missingSymbols: missing
        });
        return;
      }

      res.status(400).json({ error: "未知指令" });

    } catch (error: any) {
      logger.error(error);
      res.status(500).json({ error: error.message });
    }
  }
);