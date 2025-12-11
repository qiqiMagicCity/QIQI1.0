
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local or .env
dotenv.config({ path: resolve(__dirname, '../../.env.local') });
dotenv.config({ path: resolve(__dirname, '../../.env') });

// Import providers
// Note: Adjust relative paths if needed based on where this script is located
import { fmpProvider } from '../../functions/src/providers/close/fmp';
import { yahooProvider } from '../../functions/src/providers/close/yahoo';
import { marketstackProvider, stockdataProvider } from '../../functions/src/lib/close/priority';

const TEST_SYMBOL = 'AAPL';
const TEST_DATE = '2024-01-05'; // Known trading day

async function runTest(providerName: string, providerFn: (s: string, d: string, secrets: any) => Promise<any>, secrets: any) {
    process.stdout.write(`Testing [${providerName}]... `);
    try {
        const start = Date.now();
        const result = await providerFn(TEST_SYMBOL, TEST_DATE, secrets);
        const ms = Date.now() - start;
        console.log(`✅ Success (${ms}ms): $${result.close}`);
    } catch (err: any) {
        let msg = err.message || String(err);
        if (err.httpStatus) msg += ` (HTTP ${err.httpStatus})`;
        console.log(`❌ Failed: ${msg}`);
    }
}

async function main() {
    console.log(`\n🔍 Starting API Connectivity Diagnosis`);
    console.log(`Target: ${TEST_SYMBOL} @ ${TEST_DATE}`);
    console.log(`----------------------------------------`);

    // Prepare secrets object from env
    const secrets = {
        FMP_TOKEN: process.env.FMP_TOKEN || '',
        MARKETSTACK_API_KEY: process.env.MARKETSTACK_API_KEY || '',
        STOCKDATA_API_KEY: process.env.STOCKDATA_API_KEY || ''
    };

    // Warn if secrets missing
    if (!secrets.FMP_TOKEN) console.warn('⚠️ Warning: FMP_TOKEN is missing in env');
    if (!secrets.MARKETSTACK_API_KEY) console.warn('⚠️ Warning: MARKETSTACK_API_KEY is missing in env');
    if (!secrets.STOCKDATA_API_KEY) console.warn('⚠️ Warning: STOCKDATA_API_KEY is missing in env');

    // Test 1: FMP
    await runTest('FMP', (s, d, sec) => fmpProvider.getClose(s, d, sec), secrets);

    // Test 2: Marketstack
    await runTest('Marketstack', (s, d, sec) => marketstackProvider.getClose(s, d, sec), secrets);

    // Test 3: StockData
    await runTest('StockData', (s, d, sec) => stockdataProvider.getClose(s, d, sec), secrets);

    // Test 4: Yahoo
    await runTest('Yahoo', (s, d, sec) => yahooProvider.getClose(s, d, sec), secrets);

    console.log(`----------------------------------------`);
    console.log(`Diagnosis Complete.\n`);
}

main().catch(console.error);
