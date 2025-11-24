import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { runCloseForSymbols, CloseSecrets } from "../lib/close/run";
import { EOD_JOB_CHUNK_SIZE } from "../config/limits";

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

// YYYY-MM-DD（纽约时区）
const nyYYYYMMDD = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

// 纽约时区的星期缩写（Mon..Sun）
const nyWeekday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now); // e.g. 'Mon','Tue',...,'Sun'

// 交易日判断：周一至周五且不在 meta/marketHolidays.list 中
async function isNyTradingDay(db: admin.firestore.Firestore, ymd: string) {
  const wd = nyWeekday(); // 与 ymd 同日（来自同一次 now）
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd);
  if (!isWeekday) return false;

  try {
    const doc = await db.collection("meta").doc("marketHolidays").get();
    const list =
      (doc.data()?.list as string[] | undefined) ||
      (doc.data()?.days as string[] | undefined) ||
      [];
    return !list.includes(ymd);
  } catch {
    // 读失败时，默认当作交易日，不阻断任务
    return true;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const eodJob = onSchedule(
  {
    schedule: "5 16 * * 1-5",
    timeZone: "America/New_York",
    secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
  },
  async () => {
    const db = admin.firestore();
    const date = nyYYYYMMDD();

    // 非交易日保护（周末/节假日直接跳过）
    const tradable = await isNyTradingDay(db, date);
    if (!tradable) {
      await db
        .collection("meta")
        .doc("dailyJobs")
        .collection("eod")
        .doc(date)
        .set(
          {
            status: "skipped-non-trading-day",
            date,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      return;
    }

    const symbolsDocRef = db.collection("meta").doc("eodSymbols");
    const symbolsDoc = await symbolsDocRef.get();
    const listRaw = (symbolsDoc.data()?.list as string[] | undefined) || [];

    const list = Array.from(
      new Set(listRaw.filter(Boolean).map((s) => s.toUpperCase().trim()))
    );

    if (list.length === 0) {
      const reason =
        "No symbols configured in meta/eodSymbols for EOD job.";
      console.log(`eodJob: ${reason}`, { date });

      if (!symbolsDoc.exists) {
        await symbolsDocRef.set({ list: [] });
        console.log(
          "eodJob: Bootstrapped empty meta/eodSymbols document."
        );
      }

      await db
        .collection("meta")
        .doc("dailyJobs")
        .collection("eod")
        .doc(date)
        .set(
          {
            status: "skipped-no-symbols",
            date,
            reason,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      return;
    }

    const secrets: CloseSecrets = {
      FMP_TOKEN: FMP_TOKEN.value() || "",
      MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
      STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
    };

    try {
      const batches = chunk(list, EOD_JOB_CHUNK_SIZE);
      let results: Record<string, any> = {};

      for (const batch of batches) {
        const part = await runCloseForSymbols(db, date, batch, secrets);
        results = { ...results, ...part };
      }

      const okCount = Object.values(results).filter(
        (r: any) => r?.status === "ok"
      ).length;
      const errCount = list.length - okCount;

      await db
        .collection("meta")
        .doc("dailyJobs")
        .collection("eod")
        .doc(date)
        .set(
          {
            status: errCount > 0 ? "error" : "success",
            date,
            counts: { ok: okCount, error: errCount },
            results,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    } catch (e: any) {
      if (
        e?.code === "failed-precondition" &&
        e?.details?.reason === "no_provider_covers_date"
      ) {
        await db
          .collection("meta")
          .doc("dailyJobs")
          .collection("eod")
          .doc(date)
          .set(
            {
              status: "skipped-out-of-coverage",
              date,
              reason: e.message,
              details: e.details,
              finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      } else {
        await db
          .collection("meta")
          .doc("dailyJobs")
          .collection("eod")
          .doc(date)
          .set(
            {
              status: "error",
              date,
              reason: e?.message,
              details: e?.details,
              finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        throw e;
      }
    }
  }
);