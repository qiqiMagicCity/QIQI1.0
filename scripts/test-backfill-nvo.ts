
import { initializeFirebase } from '../src/firebase/index';
import { triggerManualBackfill } from '../src/lib/data/official-close-repo';
import { getOfficialCloses } from '../src/lib/data/official-close-repo';

async function testBackfill() {
    console.log("Initializing Firebase...");
    initializeFirebase();

    const symbol = 'NVO';
    const date = '2026-02-04';

    console.log(`Checking existing data for ${symbol} on ${date}...`);
    const before = await getOfficialCloses(date, [symbol]);
    console.log("Before:", before[symbol]);

    console.log(`Triggering Manual Backfill for ${symbol} on ${date}...`);
    try {
        await triggerManualBackfill(date, [symbol], true);
        console.log("Backfill request sent.");
    } catch (e) {
        console.error("Backfill failed:", e);
    }

    // Wait for a bit? The function is async but triggerManualBackfill waits for the function call.
    // The function call 'requestBackfillEod' returns when it's done (in the 'instant' mode for small batches).

    console.log("Re-checking data...");
    const after = await getOfficialCloses(date, [symbol]);
    console.log("After:", after[symbol]);
}

testBackfill().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
