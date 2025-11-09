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

// Use en-CA format which is YYYY-MM-DD
const nyYYYYMMDD = (now = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const eodJob = onSchedule({
  schedule: '5 16 * * 1-5',
  timeZone: 'America/New_York',
  secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY]
}, async () => {
  const db = admin.firestore();
  const date = nyYYYYMMDD();

  const symbolsDocRef = db.collection('meta').doc('eodSymbols');
  const symbolsDoc = await symbolsDocRef.get();
  const symbolsData = symbolsDoc.data();
  const list = symbolsData?.list as string[] | undefined;

  if (!list || list.length === 0) {
    const reason = 'No symbols configured in meta/eodSymbols for EOD job.';
    console.log(`eodJob: ${reason}`, { date });

    if (!symbolsDoc.exists) {
      await symbolsDocRef.set({ list: [] });
      console.log('eodJob: Bootstrapped empty meta/eodSymbols document.');
    }

    await db.doc(`meta/dailyJobs/eod-${date}`).set({
      status: 'skipped-no-symbols',
      date,
      reason,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return;
  }

  const secrets: CloseSecrets = {
    FMP_TOKEN: FMP_TOKEN.value() || '',
    MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || '',
    STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || '',
  };

  try {
    const batches = chunk(list, EOD_JOB_CHUNK_SIZE);
    let results = {};

    for (const batch of batches) {
      const part = await runCloseForSymbols(db, date, batch, secrets);
      results = { ...results, ...part };
    }

    const okCount = Object.values(results).filter((r: any) => r.status === "ok").length;
    const errCount = list.length - okCount;

    await db.doc(`meta/dailyJobs/eod-${date}`).set(
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
      e.code === "failed-precondition" &&
      e.details?.reason === "no_provider_covers_date"
    ) {
      await db.doc(`meta/dailyJobs/eod-${date}`).set(
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
      // For other errors, we should log them and mark the job as failed.
      await db.doc(`meta/dailyJobs/eod-${date}`).set(
        {
          status: "error",
          date,
          reason: e.message,
          details: e.details,
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      // Re-throwing the error will make the job execution fail.
      throw e;
    }
  }
});
