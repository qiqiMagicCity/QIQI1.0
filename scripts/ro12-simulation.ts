
// Simulation of Auto-Heal Logic for RO-12
const AUTO_HEAL_CONFIG = {
    ENABLED: true,
    MAX_SYMBOLS_PER_TASK: 10,
    MAX_DAYS_PER_SYMBOL: 22,
    SESSION_LIMIT: 50,
    RETRY_DELAY_MS: 5 * 60 * 1000,
};

let sessionRequestCount = 0;
let isEcoMode = false;
let knownSymbols = new Set<string>(['AAPL', 'TSLA']);
let attemptedBackfills = new Map<string, number>();

function simulateAutoHeal(baseHoldings: any[], memoizedM14BaseResults: any[]) {
    console.log("--- Starting AutoHeal Simulation ---");

    // [D2] New Symbol Detection
    const currentActiveSymbols = new Set(baseHoldings.map(h => h.symbol));
    const newSymbols = Array.from(currentActiveSymbols).filter(s => !knownSymbols.has(s));

    if (newSymbols.length > 0) {
        console.log(`[AutoHeal] Detected ${newSymbols.length} NEW symbols: ${newSymbols.join(', ')}. Monitoring for gaps...`);
        newSymbols.forEach(s => knownSymbols.add(s));
    }

    // 1. Scan Gaps
    const missingTasks: any[] = [];
    const now = Date.now();

    memoizedM14BaseResults.forEach(res => {
        if (res.status === 'missing_data') {
            const freshSymbols = res.missingSymbols.filter((s: string) => {
                const key = `${res.date}_${s}`;
                const lastAttempt = attemptedBackfills.get(key);
                if (lastAttempt && (now - lastAttempt < AUTO_HEAL_CONFIG.RETRY_DELAY_MS)) {
                    console.log(`[AutoHeal] DEDUPED: Skipping recently requested ${key}.`);
                    return false;
                }
                return true;
            });
            if (freshSymbols.length > 0) {
                missingTasks.push({ date: res.date, symbols: freshSymbols });
            }
        }
    });

    if (missingTasks.length === 0) return;

    // 2. Pick Task
    const task = missingTasks[0];
    let batch = task.symbols;

    // [D3] Cost Guardrails
    if (batch.length > AUTO_HEAL_CONFIG.MAX_SYMBOLS_PER_TASK) {
        console.warn(`[AutoHeal] CHUNKED: Batch size ${batch.length} exceeds limit. Requesting first ${AUTO_HEAL_CONFIG.MAX_SYMBOLS_PER_TASK}.`);
        batch = batch.slice(0, AUTO_HEAL_CONFIG.MAX_SYMBOLS_PER_TASK);
    }

    if (sessionRequestCount >= AUTO_HEAL_CONFIG.SESSION_LIMIT) {
        console.error(`[AutoHeal] SESSION_LIMIT (${AUTO_HEAL_CONFIG.SESSION_LIMIT}) reached. Enabling ECO_MODE.`);
        isEcoMode = true;
        return;
    }

    const trigger = batch.some((s: string) => newSymbols.includes(s)) ? 'NEW_SYMBOL' : 'GAP_HEALING';
    console.info(`[AutoHeal] AUTO_HEAL_ENQUEUED: symbolCount=${batch.length}, date=${task.date}, symbols=[${batch.join(', ')}], trigger=${trigger}`);

    // Mark as attempted
    batch.forEach((s: string) => attemptedBackfills.set(`${task.date}_${s}`, now));
    sessionRequestCount += batch.length;
}

// --- TEST CASE 1: New Symbol ---
const holdings1 = [{ symbol: 'NVDA' }, { symbol: 'AAPL' }];
const gaps1 = [{ date: '2026-01-01', status: 'missing_data', missingSymbols: ['NVDA'] }];
simulateAutoHeal(holdings1, gaps1);

// --- TEST CASE 2: Chunking ---
console.log("\n--- TEST CASE 2: Chunking ---");
const gaps2 = [{ date: '2026-01-02', status: 'missing_data', missingSymbols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] }];
simulateAutoHeal([{ symbol: 'AAPL' }], gaps2);

// --- TEST CASE 3: Deduping ---
console.log("\n--- TEST CASE 3: Deduping ---");
simulateAutoHeal([{ symbol: 'AAPL' }], gaps2);

// --- TEST CASE 4: Session Limit ---
console.log("\n--- TEST CASE 4: Session Limit ---");
sessionRequestCount = 45;
const gaps4 = [{ date: '2026-01-03', status: 'missing_data', missingSymbols: ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'] }];
simulateAutoHeal([{ symbol: 'AAPL' }], gaps4);
simulateAutoHeal([{ symbol: 'AAPL' }], gaps4); // This should hit limit
