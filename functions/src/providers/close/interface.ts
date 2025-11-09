export interface CloseProvider {
  name: string; // 例如 'polygon'
  getClose(symbol: string, dateYYYYMMDD: string, secrets: Record<string,string>): Promise<{
    close: number;
    currency: string;
    provider: string; // 与 name 一致
    latencyMs?: number;
    meta?: Record<string, any>;
  }>;
}