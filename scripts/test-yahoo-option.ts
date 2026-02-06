
async function testOptionFetch() {
    const symbol = 'AAPL260206C00270000'; // AAPL Feb 6 2026 Call 270
    console.log(`Testing fetch for option symbol: ${symbol}`);

    let yf: any;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('yahoo-finance2');

        if (typeof pkg.default === 'function') {
            yf = new pkg.default();
        } else if (typeof pkg === 'function') {
            yf = new pkg();
        } else {
            yf = pkg.default || pkg;
        }
        console.log("Yahoo Finance initialized successfully.");
    } catch (initErr: any) {
        console.error("Init failed", initErr);
        return;
    }

    // Test 1: Quote (Snapshot)
    console.log("\n--- Testing yf.quote() ---");
    try {
        const quote = await yf.quote(symbol);
        console.log('✅ Quote Success:');
        console.log(`  Price: ${quote.regularMarketPrice}`);
        console.log(`  Date: ${quote.regularMarketTime}`);
        console.log(`  Full Quote:`, JSON.stringify(quote, null, 2));
    } catch (error: any) {
        console.log(`❌ Quote Failed: ${error.message}`);
    }

    // Test 2: Historical
    console.log("\n--- Testing yf.historical() ---");
    try {
        // Try to fetch last few days
        const queryOptions = {
            period1: '2026-02-01', // Recent date close to current 2026-02-05
            period2: '2026-02-06',
        };
        const history = await yf.historical(symbol, queryOptions);
        console.log(`✅ Historical Success (${history.length} records):`);
        console.log(history);
    } catch (error: any) {
        console.log(`❌ Historical Failed: ${error.message}`);
    }
}

testOptionFetch();
