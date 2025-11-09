
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { fetchAndSaveOfficialClose, CloseSecrets } from "../lib/close/run";
import {
  BACKFILL_WORKER_CHUNK_SIZE,
  BACKFILL_WORKER_CONCURRENCY,
} from "../config/limits";

const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

async function executeConcurrently<T>(
  tasks: Array<() => Promise<T>>,
  concurrencyLimit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let currentIndex = 0;
  while (currentIndex < tasks.length) {
    const slice = tasks.slice(currentIndex, currentIndex + concurrencyLimit).map((fn) => fn());
    const settled = await Promise.allSettled(slice);
    results.push(...settled);
    currentIndex += slice.length;
  }
  return results;
}

export const backfillWorker = onMessagePublished({
  topic: "backfill-eod",
  secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
  maxInstances: 1
}, async (event) => {
  const db = getFirestore();
  const backfillRef = db.collection("meta/backfillRequests");
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

  const { date, symbols } = event.data.message.json;
  const secrets: CloseSecrets = {
    FMP_TOKEN: FMP_TOKEN.value(),
    MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value(),
    STOCKDATA_API_KEY: STOCKDATA_API_KEY.value(),
  };

  const runningBatch = db.batch();
  for (const symbol of symbols) {
    const docRef = backfillRef.doc(`${date}_${symbol}`);
    runningBatch.set(docRef, { status: "running", updatedAt: serverTimestamp }, { merge: true });
  }
  await runningBatch.commit();

  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += BACKFILL_WORKER_CHUNK_SIZE) {
    chunks.push(symbols.slice(i, i + BACKFILL_WORKER_CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    const batchSyms = chunks[i];
    const start = Date.now();
    logger.info(`Processing chunk ${i+1}/${chunks.length} with ${batchSyms.length} symbols (concurrency: ${BACKFILL_WORKER_CONCURRENCY})`);

    const factories = batchSyms.map((symbol) => {
      return async () => {
        try {
          await fetchAndSaveOfficialClose(db, symbol, date, secrets);
          return { symbol, ok: true as const };
        } catch (e: any) {
          return Promise.reject({
            symbol,
            message: e?.message,
            code: e?.code,
            hint: e?.details?.hint,
          });
        }
      };
    });

    const settled = await executeConcurrently(factories, BACKFILL_WORKER_CONCURRENCY);
    const results = settled.map((r) =>
      r.status === "fulfilled"
        ? { symbol: r.value.symbol, ok: true as const }
        : { symbol: (r.reason?.symbol ?? "unknown"), ok: false as const, error: { message: r.reason?.message, code: r.reason?.code, hint: r.reason?.hint } }
    );

    const okCount = results.filter(r => r.ok).length;
    const errCount = results.length - okCount;
    logger.info(`Chunk ${i+1}/${chunks.length} completed in ${Date.now()-start}ms. Success: ${okCount}, Failure: ${errCount}`);

    const updateBatch = db.batch();
    const doneTs = serverTimestamp;
    for (const r of results) {
      const docRef = backfillRef.doc(`${date}_${r.symbol}`);
      if (r.ok) {
        updateBatch.set(docRef, { status: "done", updatedAt: doneTs }, { merge: true });
      } else {
        updateBatch.set(docRef, { status: "error", error: r.error, updatedAt: doneTs }, { merge: true });
      }
    }
    await updateBatch.commit();
  }
});
