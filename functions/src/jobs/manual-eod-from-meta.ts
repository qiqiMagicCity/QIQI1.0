// functions/src/jobs/manual-eod-from-meta.ts
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https"; // HTTP 请求云函数
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { runCloseForSymbols } from "../lib/close/run";

// —— 纽约日格式校验（YYYY-MM-DD）
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// —— 纽约当前日期（America/New_York，美东时间）
function nyTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// —— 符号归一化：trim → NFKC → 去内部空白 → 大写
function normalizeSymbolForServer(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

// Secrets（密钥，外部行情 API 用）
const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

/**
 * manualRunEodForMetaSymbols
 *
 * 用途：
 * - 收盘之后，手动触发一次 EOD 写入；
 * - 自动读取 meta/eodSymbols.list 里的全部标的列表；
 * - 调用 runCloseForSymbols，把指定 date 的官方收盘价写入 officialCloses/{date_symbol}。
 *
 * 触发方式（后面会用 curl 调）：
 * - 默认用纽约“今天”：
 *   GET https://us-central1-<project-id>.cloudfunctions.net/manualRunEodForMetaSymbols
 *
 * - 或指定 date（YYYY-MM-DD）：
 *   GET https://.../manualRunEodForMetaSymbols?date=2025-11-17
 */
export const manualRunEodForMetaSymbols = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 300,
    secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
  },
  async (req, res) => {
    try {
      // 1) 解析 date 参数（query 或 body），默认为 NY 今天
      const rawDate =
        (req.query.date as string | undefined) ??
        (req.body as any)?.date ??
        nyTodayYmd();

      const date = rawDate.trim();

      if (!DATE_RE.test(date)) {
        res.status(400).json({
          ok: false,
          error: 'date must be "YYYY-MM-DD"',
        });
        return;
      }

      const todayNy = nyTodayYmd();
      // 严格时间锁：禁止今天或未来 (只允许补历史)
      if (date >= todayNy) {
        res.status(400).json({
          ok: false,
          error: `Manual EOD run is restricted to historical dates only (< today). For today's EOD, wait for realtime-eod job. Today is ${todayNy}.`,
        });
        return;
      }

      const db = admin.firestore();

      // 2) 读取 meta/eodSymbols.list
      const metaDoc = await db.collection("meta").doc("eodSymbols").get();
      const rawList = (metaDoc.get("list") ?? []) as unknown[];

      const symbols = Array.from(
        new Set(
          rawList
            .map((s) => normalizeSymbolForServer(s))
            .filter(Boolean)
        )
      );

      if (symbols.length === 0) {
        logger.warn(
          "[manualRunEodForMetaSymbols] meta/eodSymbols.list is empty",
          { date }
        );
        res.status(200).json({
          ok: true,
          date,
          symbolCount: 0,
          message:
            "meta/eodSymbols.list is empty. No symbols to run EOD for.",
        });
        return;
      }

      logger.info("[manualRunEodForMetaSymbols] start", {
        date,
        symbolCount: symbols.length,
        sampleSymbols: symbols.slice(0, 20),
      });

      // 3) 组织 secrets（传给 runCloseForSymbols 使用外部数据源）
      const secrets = {
        FMP_TOKEN: FMP_TOKEN.value() || "",
        MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
        STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
      };

      // 4) 调用核心逻辑，写入 officialCloses/{date_symbol}
      const results = await runCloseForSymbols(db, date, symbols, secrets);

      logger.info("[manualRunEodForMetaSymbols] done", {
        date,
        symbolCount: symbols.length,
      });

      res.json({
        ok: true,
        date,
        symbolCount: symbols.length,
        sampleSymbols: symbols.slice(0, 20),
        results,
      });
    } catch (err) {
      logger.error(
        "[manualRunEodForMetaSymbols] error while running EOD for meta symbols",
        err
      );
      res.status(500).json({
        ok: false,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
);