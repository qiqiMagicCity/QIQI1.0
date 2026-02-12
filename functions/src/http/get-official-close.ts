import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { runCloseForSymbols } from "../lib/close/run";
import { MAX_SYMBOLS_PER_CALL } from "../config/limits";
import { nowNyCalendarDayString } from "../lib/ny-time"; // [COMPLIANT] Use unified time util

const FMP_TOKEN = defineSecret("FMP_TOKEN");
const POLYGON_TOKEN = defineSecret("POLYGON_TOKEN");
const MARKETSTACK_API_KEY = defineSecret("MARKETSTACK_API_KEY");
const STOCKDATA_API_KEY = defineSecret("STOCKDATA_API_KEY");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Helper to normalize symbols
function normalizeSymbolForServer(s: unknown): string {
    return String(s ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
}

/**
 * Cloud Function: getOfficialClose
 * Fetches official close prices for a list of symbols on a specific date.
 */
export const getOfficialClose = onCall(
    {
        region: "us-central1",
        timeoutSeconds: 120,
        secrets: [FMP_TOKEN, POLYGON_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY],
    },
    async (request) => {
        // 1. Validation & Parsing
        const date = (request?.data?.date ?? "") as string;
        const rawSymbols = (request?.data?.symbols ?? []) as unknown[];

        if (!DATE_RE.test(date)) {
            throw new HttpsError("invalid-argument", 'Date must be "YYYY-MM-DD".');
        }

        // [COMPLIANT] Rule 2.1: Use unified NY time, do NOT use server local time
        const todayNy = nowNyCalendarDayString();

        if (date > todayNy) {
            throw new HttpsError("invalid-argument", `Date ${date} is in the future.`);
        }

        if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
            throw new HttpsError("invalid-argument", "Symbols must be non-empty.");
        }

        // 2. Normalization & Dedup
        const uniq = Array.from(new Set(rawSymbols.map(normalizeSymbolForServer).filter(Boolean)));
        if (uniq.length > MAX_SYMBOLS_PER_CALL) {
            throw new HttpsError("resource-exhausted", "Too many symbols.");
        }

        // 3. Execution (Service Layer)
        const db = admin.firestore();
        const secrets = {
            FMP_TOKEN: FMP_TOKEN.value() || "",
            POLYGON_TOKEN: POLYGON_TOKEN.value() || "",
            MARKETSTACK_API_KEY: MARKETSTACK_API_KEY.value() || "",
            STOCKDATA_API_KEY: STOCKDATA_API_KEY.value() || "",
        };

        return await runCloseForSymbols(db, date, uniq, secrets);
    }
);
