import { CloseProvider } from './interface';

export const polygonProvider: CloseProvider = {
  name: 'polygon',
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = secrets['POLYGON_TOKEN'];
    if (!token) {
      throw new Error('POLYGON_TOKEN secret not found');
    }

    const url = `https://api.polygon.io/v1/open-close/${symbol}/${dateYYYYMMDD}?apiKey=${token}`;
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
      throw new Error(`Polygon API request failed: ${response?.statusText} (status: ${response?.status})`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (data.status !== 'OK' || typeof data.close !== 'number') {
      throw new Error('Invalid response from Polygon API');
    }

    return {
      close: data.close,
      currency: 'USD', // Polygon returns USD
      provider: 'polygon',
      latencyMs,
      meta: { from: data.from, symbol: data.symbol, volume: data.volume },
    };
  },
};