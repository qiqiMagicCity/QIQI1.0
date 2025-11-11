import { CloseProvider } from './interface';

export const fmpProvider: CloseProvider = {
  name: 'fmp',
  async getClose(symbol, dateYYYYMMDD, secrets) {
    const token = (secrets as any)['FMP_TOKEN'];
    if (!token) {
      throw new Error('FMP_TOKEN secret not found');
    }

    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?from=${dateYYYYMMDD}&to=${dateYYYYMMDD}&apikey=${token}`;
    const startTime = Date.now();

    let response: any;
    for (let i = 0; i < 2; i++) {
      try {
        response = await fetch(url);
        if (response?.status !== 429 && response?.status < 500) {
          break;
        }
      } catch (e) {
        if (i === 1) throw e;
      }
      await new Promise(res => setTimeout(res, 200));
    }

    if (!response || !response.ok) {
      const status = response?.status ?? -1;
      const statusText = response?.statusText ?? 'No Response';
      const retryAfter =
        response?.headers?.get?.('Retry-After') ||
        response?.headers?.get?.('X-Rate-Limit-Reset') ||
        undefined;

      let message = statusText;
      let providerCode: string | undefined;

      try {
        const body = await response?.clone?.()?.json?.();
        if (body) {
          message = body.message || body['error-message'] || JSON.stringify(body);
          if (body.code) providerCode = body.code;
        }
      } catch (_ignore) {
        try {
          const text = await response?.text?.();
          if (text) message = text;
        } catch (_ignore2) {}
      }

      let code:
        | 'permission-denied'
        | 'resource-exhausted'
        | 'invalid-argument'
        | 'failed-precondition'
        | 'unavailable';
      let hint: string;

      if (status === 401 || status === 403) {
        code = 'permission-denied';
        hint = '检查 FMP API Key 是否有效、套餐是否包含 historical-price-full 端点权限（Firebase Secrets: FMP_TOKEN）。';
      } else if (status === 429) {
        code = 'resource-exhausted';
        hint = '达到 FMP 配额/限速；查看响应头 Retry-After 或升级套餐。';
      } else if (status >= 400 && status < 500) {
        code = 'invalid-argument';
        hint = '检查 symbol/参数是否受支持。';
      } else {
        code = 'unavailable';
        hint = 'FMP 服务暂时异常，可稍后自动重试或走其他 provider。';
      }

      throw {
        code,
        httpStatus: status,
        endpoint: url,
        providerCode,
        message,
        hint,
        rateLimitReset: retryAfter,
        ts: Date.now(),
      };
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!data?.historical || !Array.isArray(data.historical) || data.historical.length === 0) {
      throw new Error('Invalid response from FMP API: historical data missing');
    }

    const priceData = data.historical[0];
    if (typeof priceData?.close !== 'number' || priceData?.date !== dateYYYYMMDD) {
      throw new Error(`No data for ${dateYYYYMMDD} in FMP response`);
    }

    return {
      close: priceData.close,
      currency: 'USD',
      provider: 'fmp',
      latencyMs,
      meta: { changePercent: priceData.changePercent, vwap: priceData.vwap },
    };
  },
};
