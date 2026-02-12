const pkg = require('yahoo-finance2');
let yahooFinance = pkg.default || pkg;

// Handle instantiation if necessary (v2.x vs v3.x differences or CommonJS import quirks)
if (typeof yahooFinance === 'function') {
    try {
        yahooFinance = new yahooFinance();
        console.log("Instantiated YahooFinance class.");
    } catch (e) {
        // failed or not a class
    }
}
// Also check if .default is the class inside the require result
if (pkg.default && typeof pkg.default === 'function') {
    try {
        yahooFinance = new pkg.default();
        console.log("Instantiated YahooFinance class from pkg.default.");
    } catch (e) { }
}

async function testYahoo(symbol) {
    console.log(`Testing Yahoo Finance for ${symbol}...`);
    try {
        const queryOptions = {
            period1: '2026-01-01',
            period2: '2026-02-01',
            interval: '1d'
        };

        const result = await yahooFinance.historical(symbol, queryOptions);
        console.log(`[${symbol}] Result length:`, result.length);
        if (result.length > 0) {
            console.log(`[${symbol}] First row:`, JSON.stringify(result[0]));
            // Check for specific dates like Jan 2, Jan 5
            const target = result.find(test => test.date.toISOString().startsWith('2026-01-02'));
            if (target) console.log(`[${symbol}] Found Jan 02:`, target);
            else console.log(`[${symbol}] Jan 02 NOT FOUND`);

            const target2 = result.find(test => test.date.toISOString().startsWith('2026-01-05'));
            if (target2) console.log(`[${symbol}] Found Jan 05:`, target2);
            else console.log(`[${symbol}] Jan 05 NOT FOUND`);
        } else {
            console.log(`[${symbol}] No data returned.`);
        }
    } catch (error) {
        console.error(`[${symbol}] Yahoo Error:`, error.message);
        if (error.errors) {
            console.error(`[${symbol}] Yahoo Detailed Errors:`, JSON.stringify(error.errors, null, 2));
        }
    }
}

async function run() {
    console.log("=== STARTING CHECK ===");
    // 1. Check stock
    await testYahoo('GOOGL');

    // 2. Check Option (OCC Format)
    // GOOGL 260918 C 150 -> GOOGL260918C00150000
    await testYahoo('GOOGL260918C00150000');

    // 3. Check Option (Short Format - just in case)
    await testYahoo('GOOGL260918C150');

    // 4. Check another one: NIO260618P3.5 -> NIO 260618 P 00003500
    // NIO260618P3.5
    // 3.5 * 1000 = 3500 -> 00003500
    await testYahoo('NIO260618P00003500');
}

run();
