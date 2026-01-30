
import * as admin from 'firebase-admin';
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

import { nowNyCalendarDayString, isNyTradingDay } from '../lib/ny-time';
import { buildHoldingsSnapshot, Tx } from '../lib/holdings/fifo';
import { SplitEvent } from '../lib/holdings/stock-splits';
import { DailyPositionSnapshot } from '../lib/snapshot/types';

const db = admin.firestore();

/**
 * Fetch all corporate actions (active splits)
 */
async function fetchActiveSplits(): Promise<SplitEvent[]> {
    const snap = await db.collection('corporate_actions')
        .where('type', '==', 'SPLIT')
        .get();

    const splits: SplitEvent[] = [];
    snap.forEach(doc => {
        const d = doc.data();
        if (d.symbol && d.effectiveDate && d.ratio) {
            splits.push({
                symbol: d.symbol,
                effectiveDate: d.effectiveDate,
                splitRatio: Number(d.ratio)
            });
        }
    });
    return splits;
}

/**
 * Fetch and normalize user transactions
 */
async function fetchUserTransactions(uid: string): Promise<Tx[]> {
    const txs: Tx[] = [];

    // 1. Transactions Collection
    const transSnap = await db.collection(`users/${uid}/transactions`).get();
    transSnap.forEach(doc => {
        const d = doc.data();
        if (d.symbol && d.status === 'filled') { // Filter filled only if applicable, or assume all in db are valid
            // Basic normalization similar to frontend
            const qty = Number(d.qty || d.quantity || 0);
            const price = Number(d.price || d.fillPrice || 0);
            const ts = d.transactionDate ? new Date(d.transactionDate).getTime() : 0;

            if (qty !== 0 && ts > 0) {
                txs.push({
                    symbol: d.symbol.toUpperCase(),
                    assetType: (d.assetType || 'stock').toLowerCase() as any,
                    side: d.side,
                    qty,
                    price,
                    multiplier: d.multiplier, // Optional
                    transactionTimestamp: ts,
                    isOption: d.assetType === 'option',
                    opKind: d.type // 'SPLIT' checks are handled in buildHoldingsSnapshot
                });
            }
        }
    });

    // 2. Trades Collection (Legacy/IBKR imports)
    const tradesSnap = await db.collection(`users/${uid}/trades`).get();
    tradesSnap.forEach(doc => {
        const d = doc.data();
        // Determine validity
        const qty = Number(d.qty || d.quantity || 0);
        const price = Number(d.price || d.fillPrice || d.avgPrice || 0);

        let ts = 0;
        if (d.transactionDate) ts = new Date(d.transactionDate).getTime();
        else if (d.date) ts = new Date(d.date).getTime();
        else if (d.tradeDate) ts = new Date(d.tradeDate).getTime();

        if (d.symbol && qty !== 0 && ts > 0) {
            txs.push({
                symbol: d.symbol.toUpperCase(),
                assetType: (d.assetType || 'stock').toLowerCase() as any,
                side: d.side,
                qty,
                price,
                multiplier: d.multiplier,
                transactionTimestamp: ts,
                isOption: d.assetType === 'option',
                opKind: d.type
            });
        }
    });

    return txs;
}

/**
 * Fetch EOD prices for a list of symbols on a specific date
 */
async function fetchEodMap(symbols: string[], date: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (symbols.length === 0) return map;

    // Batch fetch from officialCloses
    // Ideally use batch query or 'in' clause but 'in' is limited to 10 or 30.
    // For robust large scale, fetching by date-shard (partition) is better.
    // Given the architecture, fetch by date collection group or index.

    // We assume 'officialCloses' is a root collection.
    // Querying where date == dateStr gives all closes for that day.
    // This is scalable up to ~20k documents, might read 5MB? Tolerable for a daily job.

    const snap = await db.collection('officialCloses').where('date', '==', date).get();
    snap.forEach(doc => {
        const d = doc.data();
        if (d.symbol && typeof d.close === 'number') {
            map.set(d.symbol.toUpperCase(), d.close);
        }
    });

    return map;
}

export const generateDailySnapshot = async (targetDate?: string) => {
    // 1. Determine Date
    let date = targetDate;
    if (!date) {
        // Default to "Yesterday" if running early morning, or "Today" if running late?
        // Let's assume this runs AFTER market close, so "Today".
        // But we must verify market is actually CLOSED.
        // For safety, let's use `nowNyCalendarDayString()` but maybe we should use `prevNyTradingDayString` if we are sure?
        // Let's rely on the caller or default to "Current NY Date".
        // IMPORTANT: If we run this automatically at 23:00 NY, it is for TODAY.
        date = nowNyCalendarDayString();
    }

    if (!isNyTradingDay(date)) {
        logger.info(`[Snapshot] ${date} is not a trading day. Skipping.`);
        return;
    }

    logger.info(`[Snapshot] Starting generation for ${date}...`);

    // 2. Load Global Data
    const splits = await fetchActiveSplits();
    logger.info(`[Snapshot] Loaded ${splits.length} split events.`);

    // 3. Iterate Users
    const usersSnap = await db.collection('users').get();
    logger.info(`[Snapshot] Found ${usersSnap.size} users.`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        logger.info(`[Snapshot] Processing User ${uid}...`);

        try {
            // a. Fetch transactions
            const txs = await fetchUserTransactions(uid);
            if (txs.length === 0) {
                logger.info(`[Snapshot] User ${uid} has 0 transactions. Skipping.`);
                continue;
            }

            // b. Calculate Holdings State (Quantities)
            // This applies splits and runs FIFO
            const { holdings } = buildHoldingsSnapshot(txs, date, splits);

            // Filter out closed positions (netQty 0) to save space?
            // Usually snapshots only care about OPEN positions?
            // Required fields include `quantiy` (net signed).
            // If quantity is 0, market value is 0.
            // BUT we might want to store it if there was activity today?
            // For now, only store NON-ZERO holdings to save DB space.
            const activeHoldings = holdings.filter(h => Math.abs(h.netQty) > 1e-9);

            if (activeHoldings.length === 0) {
                logger.info(`[Snapshot] User ${uid} has no open positions.`);
                continue;
            }

            // c. Fetch Pricing
            const symbols = activeHoldings.map(h => h.symbol);
            const eodMap = await fetchEodMap(symbols, date);

            // d. Build Snapshots
            const batch = db.batch();
            let opCount = 0;

            for (const h of activeHoldings) {
                const price = eodMap.get(h.symbol) || 0;

                // If price is missing, we might want to fetch 'latest available'?
                // For now, 0 or skip. 0 indicates "missing data" or "market closed?".

                const snapshotId = `${date}_${h.symbol}`;
                const docRef = db.doc(`users/${uid}/daily_snapshots/${snapshotId}`);

                const snapData: DailyPositionSnapshot = {
                    date,
                    symbol: h.symbol,
                    quantity: h.netQty,
                    costBasis: h.costBasis,
                    realizedPnlLifetime: h.realizedPnl, // Accumulated lifetime realized
                    closePrice: price,
                    marketValue: h.netQty * price * (h.multiplier || 1),
                    multiplier: h.multiplier || 1,
                    assetType: h.assetType,
                    currency: 'USD',
                    updatedAt: Date.now(),
                    source: 'auto-daily'
                };

                batch.set(docRef, snapData);
                opCount++;
            }

            await batch.commit();
            logger.info(`[Snapshot] Saved ${opCount} snapshots for User ${uid}.`);

        } catch (e) {
            logger.error(`[Snapshot] Failed for User ${uid}:`, e);
        }
    }

    logger.info(`[Snapshot] Completed for ${date}.`);
};

// Cloud Function Export (Schedule: Daily 23:30 NY)
// 0 23 * * 1-5 (Mon-Fri) - checks for holidays inside
export const scheduledDailySnapshot = onSchedule(
    {
        schedule: "30 23 * * 1-5",
        timeZone: "America/New_York",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async (event) => {
        await generateDailySnapshot();
    }
);

// Http Callable for Manual Trigger
export const manualGenerateSnapshot = onCall(async (request) => {
    // Auth check
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');
    // Admin check logic here if needed...

    // Check if user is admin or allowed
    // const uid = request.auth.uid;
    // ...

    const targetDate = request.data.date || nowNyCalendarDayString();
    await generateDailySnapshot(targetDate);
    return { success: true, message: `Snapshot triggered for ${targetDate}` };
});
