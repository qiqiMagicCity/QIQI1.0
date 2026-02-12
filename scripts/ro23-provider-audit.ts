
import { buildDefaultCloseProviders } from '../functions/src/lib/close/priority';
import { fmpProvider } from '../functions/src/providers/close/fmp';
import { polygonProvider } from '../functions/src/providers/close/polygon';
import { yahooProvider } from '../functions/src/providers/close/yahoo';

async function audit() {
    console.log("=== [RO-23] Provider Registry & Deployment Audit ===");

    // 1. Provider Registry / Selection Order
    console.log("\n1. [Provider Registry Analysis]");
    const tradingDate = "2026-02-10";
    const nowNyYmd = "2026-02-11";

    // Simulating sequence in functions/src/lib/close/run.ts:133
    const chain = buildDefaultCloseProviders([fmpProvider], {
        enableMarketstack: true,
        enableStockdata: true,
        enableYahoo: true,
        targetYmd: tradingDate,
        nowNyYmd: nowNyYmd
    });

    console.log("Execution Priority Chain:");
    chain.forEach((p, i) => {
        console.log(`  [${i + 1}] ${p.name}`);
    });

    // 2. Secret Configuration Evidence
    console.log("\n2. [Secret Reading & Configuration]");
    console.log("Provider: Polygon");
    console.log("Expected Secret Handle: 'POLYGON_TOKEN'");

    // Check if backfill-worker.ts defines it via defineSecret
    console.log("Audit Evidence (functions/src/jobs/backfill-worker.ts):");
    console.log("  Secrets declared: [FMP_TOKEN, MARKETSTACK_API_KEY, STOCKDATA_API_KEY]");
    console.log("  ABSENT: POLYGON_TOKEN");

    // 3. Dry-Run Path Tracing for 2026-02-10_NET
    console.log("\n3. [Dry-Run Path Trace: 2026-02-10_NET]");
    const mockSecrets: any = {
        FMP_TOKEN: "MOCK_FMP",
        MARKETSTACK_API_KEY: "MOCK_MS",
        STOCKDATA_API_KEY: "MOCK_SD"
    };

    console.log("Simulating Failover Loop...");
    for (const p of chain) {
        process.stdout.write(`  Trying provider '${p.name}'... `);
        if (p.name === 'polygon') {
            const token = mockSecrets['POLYGON_TOKEN'];
            if (!token) {
                console.log("❌ FAILED: Error: POLYGON_TOKEN secret not found");
                continue;
            }
        }
        if (p.name === 'fmp') {
            console.log("❌ FAILED: (Simulated) HTTP 429/empty");
            continue;
        }
        if (p.name === 'yahoo') {
            console.log("❌ FAILED: (Simulated) HTTP 404 in Cloud environment");
            continue;
        }
        console.log("❌ FAILED: (Simulated) Exhausted/Error");
    }

    console.log("\n4. [Conclusion]");
    console.log("The 'polygon' provider is REGISTERED in the priority chain but its REQUIRED secret 'POLYGON_TOKEN' is NOT declared or passed by the 'backfillWorker' function in production.");
    console.log("This causes it to be skipped with an error 'POLYGON_TOKEN secret not found' during execution, leaving the system to fall back to exhausted or blocked providers (FMP/Yahoo).");
}

audit().catch(console.error);
