
import { audit, runId } from '../src/lib/debug/eod-timeline';

async function runTimelineSimulation() {
    console.log('--- [Step 4 Audit] Timeline Trace Simulation ---');

    // 1. Simulation Start
    audit("Simulation.start", { msg: "Starting full lifecycle trace" });

    // 2. Snapshot Hydration (Instant)
    audit("Snapshot.hydrate", { snapshotDate: "2026-02-08", inventoryCount: 5, source: "mock" });

    // 3. PnL Engine Calculation (First pass with partial/snapshot data)
    audit("M14.calc.start", {
        todayNY: "2026-02-09",
        eodMapSize: 0,
        has_2026_01_06_NVDA: false
    });

    // 4. M14 Day Result (Jan 6 NVDA)
    audit("M14.dayResult.2026-01-06", { status: "missing_data", missingSymbols: ["NVDA"] });

    // 5. UI Result
    audit("UI.missingItems.compute", { missingItemsCount: 1, sample: ["2026-01-06: NVDA"] });

    // 6. Network Latency Simulation (Batch fetch takes 2 seconds)
    console.log("... simulating 2s network latency ...");
    await new Promise(r => setTimeout(r, 2000));

    // 7. Batch Done
    audit("getOfficialClosesBatch.done", {
        totalDocs: 150,
        has_2026_01_06_NVDA: true
    });

    // 8. EOD Map Merged
    audit("HoldingsProvider.eodMap.compute", {
        newSize: 150,
        has_2026_01_06_NVDA: true
    });

    // 9. Second Pass Calculation (Should happen due to context update)
    audit("M14.calc.start", {
        todayNY: "2026-02-09",
        eodMapSize: 150,
        has_2026_01_06_NVDA: true
    });

    // 10. M14 Day Result (Fixed)
    audit("M14.dayResult.2026-01-06", { status: "ok", missingSymbols: [] });

    // 11. UI Updated
    audit("UI.missingItems.compute", { missingItemsCount: 0, sample: [] });
}

runTimelineSimulation();
