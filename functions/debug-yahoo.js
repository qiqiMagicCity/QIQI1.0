const pkg = require('yahoo-finance2');
console.log("pkg.default type:", typeof pkg.default);
let yahooFinance = pkg.default;
// Some versions export the class as default and you must instantiate, 
// others export a singleton. The error suggests we need `new`.
try {
    if (typeof pkg.default === 'function') {
        yahooFinance = new pkg.default();
        console.log("Instantiated YahooFinance class.");
    }
} catch (e) {
    console.log("Instantiation failed/not needed:", e.message);
}

async function testYahoo(symbol) {
    console.log(`Testing Yahoo Finance for ${symbol}...`);
    try {
        const queryOptions = {
            period1: '2024-01-01',
            period2: '2025-12-05', // Current date in sim (as per metadata context, but real date is 2024? No metadata says 2025-12-05)
            interval: '1d'
        };
        // wait, today is 2025??? The metadata says 2025-12-05.
        // Yahoo API might not have future data if this is a simulation.
        // But let's assume valid historical query.

        const result = await yahooFinance.historical(symbol, queryOptions);
        console.log("Result length:", result.length);
        if (result.length > 0) {
            console.log("First row:", result[0]);
            console.log("Last row:", result[result.length - 1]);
        }
    } catch (error) {
        console.error("Yahoo Error:", error.message);
        console.error("Full Error:", error);
    }
}

testYahoo('SMCI');
testYahoo('NVO');
