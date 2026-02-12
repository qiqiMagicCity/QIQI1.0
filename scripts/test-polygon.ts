
const POLYGON_KEY = 'aojvyHz0PyZ90AUDRRVtHpMEZLMA2EAC';

async function testPolygon() {
    console.log('=== Polygon.io Connectivity Test (V2 Aggs) ===');

    // 1. Stock EOD Test (Long History - 8 Years Ago)
    const eightYearsAgo = '2018-01-05';
    // Use Aggs (OHLCV)
    const stockUrl = `https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/${eightYearsAgo}/${eightYearsAgo}?adjusted=true&sort=asc&limit=120&apiKey=${POLYGON_KEY}`;

    console.log(`\n1. Testing Stock History (AAPL on ${eightYearsAgo})...`);
    console.log(`URL: ${stockUrl}`);
    try {
        const res = await fetch(stockUrl);
        const data: any = await res.json();

        if (res.ok && data.results && data.results.length > 0) {
            console.log('✅ Stock History: SUCCESS');
            console.log(`Response: Close=${data.results[0].c}, Status=${data.status}`);
        } else {
            console.log('❌ Stock History: FAILED');
            console.log(`Error: ${JSON.stringify(data)}`);
        }
    } catch (e: any) {
        console.log('❌ Stock History: EXCEPTION', e.message);
    }

    // 2. Option Schema Test (Recent - e.g. 1 month ago)
    console.log(`\n2. Testing Option Recent History (Via Aggs)...`);

    // Find a recent Monday to avoid weekends
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30);
    // Ensure it's a weekday
    while (recentDate.getDay() === 0 || recentDate.getDay() === 6) {
        recentDate.setDate(recentDate.getDate() - 1);
    }
    const recentDateStr = recentDate.toISOString().split('T')[0];

    try {
        console.log(`Fetching a valid option ticker for ${recentDateStr}...`);
        // We still need the ticker. v3/reference/options/contracts seems to work (return 200) in previous test but failed at fetching data.
        const listUrl = `https://api.polygon.io/v3/reference/options/contracts?underlying_ticker=SPY&expiration_date.gte=${recentDateStr}&limit=1&apiKey=${POLYGON_KEY}`;
        const listRes = await fetch(listUrl);
        const listData: any = await listRes.json();

        if (listData.results && listData.results.length > 0) {
            const optionTicker = listData.results[0].ticker;
            console.log(`Found Ticker: ${optionTicker}`);

            // Now query Aggs for this ticker
            const optUrl = `https://api.polygon.io/v2/aggs/ticker/${optionTicker}/range/1/day/${recentDateStr}/${recentDateStr}?adjusted=true&sort=asc&apiKey=${POLYGON_KEY}`;
            console.log(`Querying: ${optUrl}`);
            const optRes = await fetch(optUrl);
            const optData: any = await optRes.json();

            if (optRes.ok && optData.results && optData.results.length > 0) {
                console.log('✅ Option Recent: SUCCESS');
                console.log(`Data: Open=${optData.results[0].o}, Close=${optData.results[0].c}, Volume=${optData.results[0].v}`);
            } else {
                console.log('❌ Option Recent: FAILED');
                console.log(`Status: ${optRes.status}, Message: ${JSON.stringify(optData)}`);
            }
        } else {
            console.log('Could not find valid option ticker.');
        }
    } catch (e: any) {
        console.log('❌ Option Test: EXCEPTION', e.message);
    }
}

testPolygon();
