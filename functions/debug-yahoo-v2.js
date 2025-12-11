const pkg = require('yahoo-finance2');

async function run(symbol, dateStr) {
    let yf;
    try {
        // Try various instantiation methods based on common CommonJS/TS interop patterns
        if (typeof pkg.default === 'function') {
            yf = new pkg.default();
        } else if (typeof pkg === 'function') {
            yf = new pkg();
        } else {
            yf = pkg.default || pkg;
        }
    } catch (e) {
        console.error("Init Error:", e.message);
        return;
    }

    console.log(`\n--- Testing ${symbol} for ${dateStr} ---`);

    const queryDate = new Date(dateStr);
    const nextDate = new Date(queryDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // Fetch 2 years to be safe and see what we get
    const fromDate = new Date(queryDate);
    fromDate.setFullYear(fromDate.getFullYear() - 2);

    const queryOptions = {
        period1: fromDate.toISOString().slice(0, 10),
        period2: nextDate.toISOString().slice(0, 10)
    };

    console.log("Query Options:", queryOptions);

    try {
        const result = await yf.historical(symbol, queryOptions);
        console.log(`Length: ${result.length}`);

        // Debug first match
        if (result.length > 0) {
            console.log("Sample (first):", result[0]);
            console.log("Sample (last):", result[result.length - 1]);
        }

        // Check for specific date
        // Use UTC date parts to match
        const match = result.find(item => {
            const d = item.date.toISOString().slice(0, 10);
            return d === dateStr;
        });

        if (match) {
            console.log("✅ FOUND MATCH (UTC):", match);
        } else {
            console.log("❌ NO MATCH for", dateStr);
            // Print last 5
            console.log("Tail:", result.slice(-5));
        }

    } catch (e) {
        console.error("API Error:", e.message);
        if (e.errors) console.error("Details:", JSON.stringify(e.errors, null, 2));
    }
}

// Test cases
(async () => {
    await run('GGLL', '2025-11-24');
    await run('UMAC', '2025-12-04');
})();
