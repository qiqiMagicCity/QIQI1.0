import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { runCloseForSymbols } from "../lib/close/run";

const FMP_TOKEN = defineSecret("FMP_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");
const FINNHUB_API_KEY = defineSecret("FINNHUB_API_KEY");

// NY Today Helper
const nyTodayYmd = (): string =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

/**
 * Server-Side EOD Fetcher (Full Auto Mode)
 * Runs automatically at 20:00 ET (8:00 PM ET) every weekday.
 * 
 * Logic:
 * 1. Reads the full list of EOD symbols from meta/eodSymbols.
 * 2. Checks if each symbol already has a "realtime" or "official" EOD entry for today.
 * 3. If missing, it actively calls external APIs (FMP -> Finnhub -> others) to fetch data.
 * 4. Writes the result to officialCloses/{date}_{symbol}.
 * 
 * This ensures EOD data is completed even if no user was online during market close.
 * It uses "bypassDateCheck: true" to allow writing "today's" data.
 */
export const serverSideEodJob = onSchedule(
    {
        schedule: "0 20 * * 1-5", // 20:00 ET Mon-Fri
        timeZone: "America/New_York",
        timeoutSeconds: 3600, // 1 hour max, sufficient for batch processing
        memory: "512MiB",
        secrets: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY, FINNHUB_API_KEY],
    },
    async () => {
        const date = nyTodayYmd();
        // Safety: Ensure it's not weekend (though schedule handles 1-5, Cron is dumb so double check is nice but mostly redundant if Cron works)
        // We trust Cron "1-5".

        const db = admin.firestore();

        logger.info(`[serverSideEodJob] Starting Full Auto EOD for ${date}`);

        // 1. Load symbols
        const metaDoc = await db.collection("meta").doc("eodSymbols").get();
        const rawList = (metaDoc.get("list") ?? []) as unknown[];
        const symbols = Array.from(new Set(rawList.map(s => String(s).toUpperCase().trim()).filter(Boolean)));

        if (symbols.length === 0) {
            logger.info("[serverSideEodJob] No symbols found in meta/eodSymbols. Nothing to do.");
            return;
        }

        logger.info(`[serverSideEodJob] Found ${symbols.length} symbols to check.`);

        // 2. Prepare Secrets
        const secrets = {
            FMP_TOKEN: FMP_TOKEN.value() || "",
            MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
            STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
            FINNHUB_API_KEY: FINNHUB_API_KEY.value() || "",
        };

        // 3. Run with bypassDateCheck = true
        // This function internally skips API calls if a valid "realtime" EOD already exists for this date.
        // This is the "Traffic Explosion Prevention" mechanism.
        const results = await runCloseForSymbols(db, date, symbols, secrets, { bypassDateCheck: true });

        // 4. Summarize
        const success = Object.values(results).filter(r => r.status === "ok").length;
        const failures = Object.values(results).filter(r => r.status === "error").length;
        const missing = Object.values(results).filter(r => r.status === "missing_vendor" || r.status === "market_closed").length;

        logger.info("[serverSideEodJob] Finished", {
            date,
            total: symbols.length,
            success,
            failures,
            missing
        });
    }
);
