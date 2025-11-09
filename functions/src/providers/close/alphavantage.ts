import { CloseProvider } from './interface';

export const alphaVantageProvider: CloseProvider = {
  name: 'alphavantage',
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = secrets['ALPHAVANTAGE_TOKEN'];
    if (!token) {
      throw new Error('ALPHAVANTAGE_TOKEN secret not found');
    }

    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${symbol}&apikey=${token}`;
    const startTime = Date.now();

    let response: Response | undefined;
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url);
        if (response.status < 500) { // AlphaVantage may have rate limits not explicitly 429
          break;
        }
      } catch (e) {
        if (i === 1) throw e;
      }
      await new Promise(res => setTimeout(res, 200));
    }

    if (!response || !response.ok) {
      throw new Error(`AlphaVantage API request failed: ${response?.statusText}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    const timeSeries = data['Time Series (Daily)'];
    if (!timeSeries || !timeSeries[dateYYYYMMDD]) {
      // Check for API limit note
      if (data['Note']) {
        throw new Error(`AlphaVantage API limit likely reached: ${data['Note']}`);
      }
      throw new Error(`No data for ${dateYYYYMMDD} in AlphaVantage response`);
    }

    const dayData = timeSeries[dateYYYYMMDD];
    const close = parseFloat(dayData['4. close']);

    if (isNaN(close)) {
      throw new Error('Invalid close price from AlphaVantage');
    }

    return {
      close,
      currency: 'USD', // Assuming USD, AlphaVantage doesn't specify
      provider: 'alphavantage',
      latencyMs,
      meta: { '2. symbol': data['Meta Data']?.['2. Symbol'] },
    };
  },
};