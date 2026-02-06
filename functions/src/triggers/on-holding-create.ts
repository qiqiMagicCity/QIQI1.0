
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { PubSub } from "@google-cloud/pubsub";
import { toNyCalendarDayString, prevNyTradingDayString } from "../lib/ny-time";

const pubsub = new PubSub();

/**
 * [Triggers] When a new holding is created (e.g. first purchase of a stock/option),
 * automatically verify if we have its EOD history. If not, trigger a backfill.
 * 
 * This satisfies the user requirement: "User enters transaction -> System calculates".
 * Instead of waiting for a nightly job or manual fix, we react immediately.
 */
export const onHoldingCreate = onDocumentCreated(
    "users/{uid}/holdings/{holdingId}",
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) return;

        const data = snapshot.data();
        const symbol = data.symbol;

        if (!symbol) return;

        console.log(`[onHoldingCreate] New holding detected: ${symbol}. Checking EOD health...`);

        const db = admin.firestore();

        // Determine the target check date (Yesterday's Close)
        // If we have yesterday's close, we assume history is generally healthy (as bulk fetch populates it).
        // If we DON'T have yesterday's close, it's a new symbol or broken data -> Fetch it.
        const todayNy = toNyCalendarDayString(new Date());
        const targetDate = prevNyTradingDayString(todayNy);

        // Check if officialClose exists
        const docId = `${targetDate}_${symbol}`;
        const closeSnap = await db.collection("officialCloses").doc(docId).get();

        if (closeSnap.exists && closeSnap.data()?.status === 'ok') {
            console.log(`[onHoldingCreate] EOD data for ${symbol} (${targetDate}) exists. No action needed.`);
            return;
        }

        // Missing data -> Trigger Backfill
        console.log(`[onHoldingCreate] Missing EOD for ${symbol} (${targetDate}). Triggering auto-backfill.`);

        try {
            await pubsub.topic("backfill-eod").publishMessage({
                json: {
                    date: targetDate, // Worker will fetch this date + 2 years history via Yahoo
                    symbols: [symbol],
                    reason: "new_holding_trigger"
                },
            });
            console.log(`[onHoldingCreate] Backfill task published for ${symbol}`);
        } catch (e: any) {
            console.error(`[onHoldingCreate] Failed to publish backfill task: ${e.message}`);
        }
    }
);
