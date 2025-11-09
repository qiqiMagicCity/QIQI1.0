import { CloseProvider } from './interface';

export const tiingoProvider: CloseProvider = {
  name: 'tiingo',
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = secrets['TIINGO_TOKEN'];
    if (!token) {
      throw new Error('TIINGO_TOKEN secret not found');
    }

    const url = `https://api.tiingo.com/tiingo/daily/${symbol}/prices?startDate=${dateYYYYMMDD}&endDate=${dateYYYYMMDD}`;
    const startTime = Date.now();

    let response: Response | undefined;
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url, { headers: { 'Authorization': `Token ${token}` } });
        if (response.status !== 429 && response.status < 500) {
          break;
        }
      } catch (e) {
        if (i === 1) throw e;
      }
      await new Promise(res => setTimeout(res, 200));
    }

    if (!response || !response.ok) {
      throw new Error(`Tiingo API request failed: ${response?.statusText} (status: ${response?.status})`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid response from Tiingo API: expected an array');
    }

    const priceData = data[0];
    if (typeof priceData.close !== 'number' || priceData.date.substring(0, 10) !== dateYYYYMMDD) {
      throw new Error(`No data for ${dateYYYYMMDD} in Tiingo response`);
    }

    return {
      close: priceData.close,
      currency: 'USD',
      provider: 'tiingo',
      latencyMs,
      meta: { adjClose: priceData.adjClose, volume: priceData.volume },
    };
  },
};