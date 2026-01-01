
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { isNyTradingDay, toNyCalendarDayString } from "../lib/ny-time";

const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

/**
 * Admin Job: Global Historical EOD Self-Check & Backfill
 * 
 * 1. Scan all user transactions to find unique symbols and their earliest occurrence.
 * 2. For each symbol, iterate from earliest date to yesterday.
 * 3. Identify MISSING EOD docs (officialCloses/{date}_{symbol}) on TRADING DAYS.
 * 4. Trigger backfill (INLINE EXECUTION) for missing items.
 * 
 * NOTE: This is an expensive logic. Runs with high timeout/memory.
 */
export const rebuildHistoricalEod = onCall(
    {
        region: "us-central1",
        timeoutSeconds: 540, // Max 9 mins
        memory: "1GiB",
        secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "User must be authenticated.");
        }
        const uid = request.auth.uid;

        const db = getFirestore();
        logger.info("[rebuildHistoricalEod] Started by user", { uid });

        // Prepare Secrets
        const secrets = {
            FMP_TOKEN: FMP_TOKEN.value(),
            MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value(),
            STOCKDATA_API_KEY: STOCKDATA_API_KEY.value(),
        };

        try {
            const symbolsMap = new Map<string, string>(); // Symbol -> Earliest Date found

            // 2. Scan Transactions
            const txSnapshot = await db.collection(`users/${uid}/transactions`).get();
            if (txSnapshot.empty) {
                return { message: "No transactions found for user." };
            }

            txSnapshot.forEach(doc => {
                const data = doc.data();
                const sym = data.symbol;
                const ts = data.transactionTimestamp; // number
                if (typeof sym === 'string' && typeof ts === 'number') {
                    const cleanSym = sym.toUpperCase().trim();
                    const dateStr = toNyCalendarDayString(ts);

                    // Filter out Options
                    if (cleanSym.length > 15) {
                        return;
                    }

                    if (!symbolsMap.has(cleanSym)) {
                        symbolsMap.set(cleanSym, dateStr);
                    } else {
                        const existing = symbolsMap.get(cleanSym)!;
                        if (dateStr < existing) {
                            symbolsMap.set(cleanSym, dateStr);
                        }
                    }
                }
            });

            const uniqueSymbols = Array.from(symbolsMap.keys());
            logger.info(`[rebuildHistoricalEod] Found ${uniqueSymbols.length} unique symbols.`);

            // 3. Check Gaps
            const todayNy = toNyCalendarDayString(Date.now());
            const stats = {
                checked: 0,
                missing: 0,
                success: 0,
                failed: 0,
                details: [] as string[]
            };

            const allTasks: { symbol: string, date: string }[] = [];

            for (const [symbol, startDate] of symbolsMap.entries()) {
                // Use the earliest transaction date found for this symbol
                let curr = new Date(startDate);
                // Adjust to UTC midnight to be safe for iteration
                curr.setUTCHours(0, 0, 0, 0);

                // Safeguard: Don't go beyond 5 years
                const cutoff = new Date();
                cutoff.setFullYear(cutoff.getFullYear() - 5);
                if (curr < cutoff) {
                    curr = cutoff;
                }

                const existingDocsSnapshot = await db.collection('officialCloses')
                    .where('symbol', '==', symbol)
                    .get();

                const existingDates = new Set<string>();
                existingDocsSnapshot.forEach(d => {
                    const data = d.data();
                    const dDate = data.tradingDate || data.date;
                    if (!dDate) return;

                    if (data.status === 'ok') {
                        // Only trust OK if price is valid > 0
                        if (typeof data.close === 'number' && data.close > 0) {
                            existingDates.add(dDate);
                        }
                    } else if (data.status === 'market_closed') {
                        // Only trust 'market_closed' if our system agrees it's NOT a trading day.
                        // If our system thinks it IS a trading day, we should retry (maybe provider error).
                        if (!isNyTradingDay(dDate)) {
                            existingDates.add(dDate);
                        }
                    }
                    // For 'missing_vendor' or other statuses, we do NOT add to existingDates,
                    // effectively forcing a retry (re-backfill).
                });

                const loopCancelAt = new Date(todayNy);
                loopCancelAt.setUTCHours(0, 0, 0, 0); // Align comparison

                while (curr < loopCancelAt) {
                    const dStr = toNyCalendarDayString(curr.getTime());

                    // Double check cutoff to prevent future dates (timezone edge cases)
                    if (dStr >= todayNy) break;

                    if (isNyTradingDay(dStr)) {
                        if (!existingDates.has(dStr)) {
                            allTasks.push({ symbol, date: dStr });
                        }
                    }
                    curr = new Date(curr.getTime() + 24 * 60 * 60 * 1000);
                }
                stats.checked++;
            }

            stats.missing = allTasks.length;
            const expectedDocIds = allTasks.map(t => `${t.date}_${t.symbol}`);

            logger.info(`[rebuildHistoricalEod] Starting INLINE execution for ${allTasks.length} tasks...`);

            // 4. INLINE EXECUTION
            // Config: Concurrency 5, Delay 500ms
            const CONCURRENCY = 5;

            // Import fetch function dynamically
            const { fetchAndSaveOfficialClose } = await import("../lib/close/run");

            for (let i = 0; i < allTasks.length; i += CONCURRENCY) {
                const chunk = allTasks.slice(i, i + CONCURRENCY);

                await Promise.all(chunk.map(async (task) => {
                    const docId = `${task.date}_${task.symbol}`;
                    try {
                        // Delay 100ms per task to be nicer to APIs but faster
                        await new Promise(r => setTimeout(r, 100));

                        const result = await fetchAndSaveOfficialClose(
                            db,
                            task.symbol,
                            task.date,
                            secrets
                        );

                        // Upsert Request Status for Frontend Tracking
                        const status = result.status === 'ok' ? 'done' : 'error';
                        const errorMsg = result.status === 'ok' ? null : `Status: ${result.status}`;

                        await db.collection('meta/backfill/requests').doc(docId).set({
                            date: task.date,
                            symbol: task.symbol,
                            status: status,
                            error: errorMsg,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });

                        if (status === 'done') {
                            stats.success++;
                        } else {
                            stats.failed++;
                            logger.warn(`[Fail] ${docId}: ${errorMsg}`);
                        }

                    } catch (e: any) {
                        stats.failed++;
                        logger.error(`[Exception] ${docId}`, e);
                        await db.collection('meta/backfill/requests').doc(docId).set({
                            date: task.date,
                            symbol: task.symbol,
                            status: 'error',
                            error: e.message,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });
                    }
                }));
            }

            logger.info("[rebuildHistoricalEod] Finished Inline.", stats);
            return { success: true, stats, expectedDocIds };

        } catch (error: any) {
            logger.error("[rebuildHistoricalEod] Failed", error);
            throw new HttpsError('internal', `Check Failed: ${error.message}`);
        }
    }
);
