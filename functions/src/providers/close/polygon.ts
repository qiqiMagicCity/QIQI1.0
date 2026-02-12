import { CloseProvider } from './interface';

export const polygonProvider: CloseProvider = {
  name: 'polygon',
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = secrets['POLYGON_TOKEN'];
    if (!token) {
      throw new Error('POLYGON_TOKEN secret not found');
    }

    // Use v2/aggs for better historical coverage (Stock 10y+, Option 2y)
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${dateYYYYMMDD}/${dateYYYYMMDD}?adjusted=true&sort=asc&limit=1&apiKey=${token}`;
    const startTime = Date.now();

    // Simple retry mechanism
    let response: Response | undefined;
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url);
        if (response.status !== 429 && response.status < 500) {
          break; // Success or non-retriable error
        }
      } catch (e) {
        if (i === 1) throw e; // Rethrow on last attempt
      }
      await new Promise(res => setTimeout(res, 200)); // Wait before retry
    }

    if (!response || !response.ok) {
      // v2/aggs might return 200 with empty results if no data, or 404/403 if invalid
      throw new Error(`Polygon API request failed: ${response?.statusText} (status: ${response?.status})`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    // Check for results
    if (data.status !== 'OK' && data.status !== 'DELAYED') {
      // 'DELAYED' might be returned for 15min delayed stocks? usually 'OK'
      // Actually v2/aggs returns OK usually.
      // Also check results array
    }

    if (!data.results || data.results.length === 0) {
      console.warn(`[Polygon] No data for ${symbol} on ${dateYYYYMMDD}. URL: ${url.replace(token, 'REDACTED')}. Status: ${data.status}`);
      throw new Error('No data returned from Polygon (Market Closed or Invalid Date)');
    }

    const candle = data.results[0];
    const closePrice = candle.c;

    if (typeof closePrice !== 'number') {
      throw new Error('Invalid close price from Polygon API');
    }

    return {
      close: closePrice,
      currency: 'USD',
      provider: 'polygon',
      latencyMs,
      meta: {
        from: dateYYYYMMDD,
        symbol: data.ticker,
        volume: candle.v,
        high: candle.h,
        low: candle.l,
        open: candle.o
      },
    };
  },
};