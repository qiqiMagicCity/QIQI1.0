import { CloseProvider } from './interface';

export const tiingoProvider: CloseProvider = {
  name: 'tiingo',
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = secrets['TIINGO_TOKEN'];
    if (!token) {
      throw new Error('TIINGO_TOKEN secret not found');
    }

    const upperSymbol = symbol.toUpperCase().trim();
    const isOption = /^[A-Z]+\d{6}[CP][\d.]+$/.test(upperSymbol);

    let url: string;
    const startTime = Date.now();

    if (isOption) {
      // Tiingo Option API
      // We need ticker + osiSymbol
      const match = upperSymbol.match(/^([A-Z]+)/);
      const ticker = match ? match[1] : '';
      const { convertShortOptionToOcc } = require('../../lib/close/priority');
      const osi = convertShortOptionToOcc(upperSymbol, false);

      url = `https://api.tiingo.com/tiingo/options/prices?ticker=${ticker}&optionSymbol=${osi}&startDate=${dateYYYYMMDD}&endDate=${dateYYYYMMDD}`;
      console.log(`[Tiingo-Option] Fetching ${osi} for ${dateYYYYMMDD}...`);
    } else {
      url = `https://api.tiingo.com/tiingo/daily/${upperSymbol}/prices?startDate=${dateYYYYMMDD}&endDate=${dateYYYYMMDD}`;
    }

    let response: Response | undefined;
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url, { headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' } });
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
      throw new Error(`Tiingo returned no data for ${upperSymbol} on ${dateYYYYMMDD}`);
    }

    const priceData = data[0];
    // Option API returns { date, close, ... }
    // Stock API returns { date, close, ... }

    if (typeof priceData.close !== 'number') {
      throw new Error(`Tiingo returned invalid price for ${upperSymbol}`);
    }

    return {
      close: priceData.close,
      currency: 'USD',
      provider: isOption ? 'tiingo-option' : 'tiingo',
      latencyMs,
      meta: { ...priceData },
    };
  },
};