// functions/src/providers/close/interface.ts

export interface CloseProvider {
  name: string; // 例如 'polygon'

  /**
   * getClose：
   * - symbol: 标的代码（如 'GOOGL'）
   * - dateYYYYMMDD: 目标日期（纽约日，格式 YYYY-MM-DD）
   * - secrets: 各种 API Secret（应用密钥）
   * - ctx: 可选上下文，用来传递 db 等额外能力（例如 Firestore 实例）
   */
  getClose(
    symbol: string,
    dateYYYYMMDD: string,
    secrets: Record<string, string>,
    ctx?: any
  ): Promise<{
    close: number;
    currency: string;
    provider: string; // 与 name 一致
    latencyMs?: number;
    meta?: Record<string, any>;
  }>;
}