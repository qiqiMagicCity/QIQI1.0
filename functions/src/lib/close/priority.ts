import { CloseProvider } from '../../providers/close/interface';
import { coversDate } from './capabilities';
import { tiingoProvider } from '../../providers/close/tiingo';
import { fmpProvider } from '../../providers/close/fmp';
import { polygonProvider } from '../../providers/close/polygon';
import { alphaVantageProvider } from '../../providers/close/alphavantage';

interface Attempt {
  p: string;
  s: 'ok' | 'skipped' | 'error';
  error?: { message: string; code?: string };
  provider?: string;
}

// Inlined Marketstack Provider
const marketstackProvider: CloseProvider = {
  name: "marketstack",
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const apiKey = secrets['MARKETSTACK_API_KEY'];
    if (!apiKey) {
      throw new Error('MARKETSTACK_API_KEY secret not found');
    }

    const url = `http://api.marketstack.com/v1/eod?access_key=${apiKey}&symbols=${symbol}&date_from=${dateYYYYMMDD}&date_to=${dateYYYYMMDD}&limit=1`;
    const startTime = Date.now();

    let response: any; // Changed from Response | undefined
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url);
        if (response.status !== 429 && response.status < 500) {
          break;
        }
      } catch (e) {
        if (i === 1) throw e;
      }
      await new Promise(res => setTimeout(res, 200));
    }

    if (!response || !response.ok) {
      throw new Error(`Marketstack API request failed: ${response?.statusText} (status: ${response?.status})`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error(`No data for ${dateYYYYMMDD} in Marketstack response`);
    }

    const priceData = data.data[0];
    const extractedDate = (priceData.date || '').substring(0, 10);
    if (typeof priceData.close !== 'number' || extractedDate !== dateYYYYMMDD) {
      throw new Error(`Invalid close price or date from Marketstack. Expected ${dateYYYYMMDD}, got ${extractedDate}`);
    }

    return {
      close: priceData.close,
      date: dateYYYYMMDD, // Added date field
      currency: 'USD',
      provider: 'marketstack',
      latencyMs,
      meta: { exchange: priceData.exchange, volume: priceData.volume },
    };
  },
};

// Inlined StockData.org Provider
const stockdataProvider: CloseProvider = {
  name: "stockdata",
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const apiKey = secrets['STOCKDATA_API_KEY'];
    if (!apiKey) {
      throw new Error('STOCKDATA_API_KEY secret not found');
    }

    const startTime = Date.now();
    let response: any;
    let data: any;

    // First attempt with `date` parameter
    const url1 = `https://api.stockdata.org/v1/data/eod?api_token=${apiKey}&symbols=${symbol}&date=${dateYYYYMMDD}&limit=1`;
    response = await fetch(url1);

    if (!response.ok) {
      throw new Error(`StockData.org API request failed: ${response?.statusText} (status: ${response?.status})`);
    }
    data = await response.json();

    // If first attempt is empty, try fallback with `date_from` and `date_to`
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      const url2 = `https://api.stockdata.org/v1/data/eod?api_token=${apiKey}&symbols=${symbol}&date_from=${dateYYYYMMDD}&date_to=${dateYYYYMMDD}&limit=1`;
      response = await fetch(url2);

      if (!response.ok) {
        throw new Error(`StockData.org fallback API request failed: ${response?.statusText} (status: ${response?.status})`);
      }
      data = await response.json();

      // If fallback is also empty, throw error
      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        throw new Error(`No data for ${dateYYYYMMDD} in StockData.org response (both date and date_from/date_to empty)`);
      }
    }
    
    const latencyMs = Date.now() - startTime;
    const priceData = data.data[0];
    const extractedDate = (priceData.date || "").slice(0,10);

    if (typeof priceData.close !== "number" || extractedDate !== dateYYYYMMDD) {
      throw new Error(`Invalid close price or date from StockData.org. Expected ${dateYYYYMMDD}, got ${extractedDate}`);
    }

    return {
      close: priceData.close,
      date: dateYYYYMMDD,
      currency: 'USD',
      provider: 'stockdata',
      latencyMs,
      meta: { volume: priceData.volume },
    };
  },
};

export function buildDefaultCloseProviders(
  existing: CloseProvider[] = [],
  opts?: {
    enableMarketstack?: boolean;
    enableStockdata?: boolean;
    targetYmd?: string;
    nowNyYmd?: string;
  },
): CloseProvider[] {
  const providers: CloseProvider[] = [...existing];

  // Dynamically add Marketstack if enabled via opts
  if (opts?.enableMarketstack) {
    providers.push(marketstackProvider);
  }

  // Dynamically add StockData.org if enabled via opts
  if (opts?.enableStockdata) {
    providers.push(stockdataProvider);
  }

  // Remove duplicates by name (preserving first occurrence order)
  const uniqueProvidersMap = new Map<string, CloseProvider>();
  for (const p of providers) {
    if (!uniqueProvidersMap.has(p.name)) {
      uniqueProvidersMap.set(p.name, p);
    }
  }

  let uniqueProviders = Array.from(uniqueProvidersMap.values());

  // Filter by date coverage if date is provided
  if (opts?.targetYmd && opts?.nowNyYmd) {
    uniqueProviders = uniqueProviders.filter((p) =>
      coversDate(p.name, opts.targetYmd!, opts.nowNyYmd!),
    );
  }

  return uniqueProviders;
}

export async function getCloseWithFailover(
  providers: CloseProvider[],
  symbol: string,
  date: string,
  secrets: Record<string, string>
) {
  const attempts: Attempt[] = [];
  let result: Awaited<ReturnType<CloseProvider['getClose']>> | null = null;

  for (const provider of providers) {
    if (result) {
      attempts.push({ p: provider.name, s: 'skipped' });
      continue;
    }
    try {
      const closeData = await provider.getClose(symbol, date, secrets);
      result = closeData;
      attempts.push({ p: provider.name, s: 'ok' });
    } catch (e: any) {
      attempts.push({
        p: provider.name, // 旧字段（兼容）
        provider: provider.name, // 新字段（可读性更强）
        symbol,
        s: 'error',
        error: e?.message ?? String(e),
        code: e?.code,
        httpStatus: e?.httpStatus,
        endpoint: e?.endpoint,
        providerCode: e?.providerCode,
        hint: e?.hint,
        rateLimitReset: e?.rateLimitReset,
        ts: e?.ts ?? Date.now(),
      });
    }
  }

  if (result) {
    return { ...result, attempts };
  }

  throw new Error('All providers failed to get close price', { cause: attempts });
}