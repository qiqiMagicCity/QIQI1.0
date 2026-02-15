import { toNyCalendarDayString } from '@/lib/ny-time';

// #region: Type Definitions
export type AssetType = 'stock' | 'option';
export type SideTx = 'BUY' | 'SELL' | 'NOTE';

export interface Tx {
  id?: string; // [FIX] Add optional ID to interface for tracing
  symbol: string;
  assetType?: AssetType;
  side?: SideTx;
  qty: number;
  price: number;
  multiplier?: number;
  transactionTimestamp: number; // UTC milliseconds（协调世界时毫秒时间戳）
  // —— 可选：来自 use-user-transactions 的扩展字段 —— 
  contractKey?: string; // 标的去空格 + 到期日 + 行权价 + C/P（期权合约标识）
  isOption?: boolean;   // 是否期权，优先使用 assetType==='option'
  opKind?: string;      // 操作类型 (BUY, SELL, SPLIT, etc.)
}

export interface Holding {
  symbol: string;
  assetType: AssetType;
  netQty: number;
  multiplier: number;
  costBasis: number;
  costPerUnit: number;
  realizedPnl: number;
  side: 'LONG' | 'SHORT';
  lastTxNy: string;
  nowPrice: null;
  plFloating: "--";
  status: 'calc_pending';
  anomalies: string[];
  lots: FifoLayer[]; // [New] Expose specific cost layers
  isHidden?: boolean;
}

export interface Snapshot {
  holdings: Holding[];
  audit: {
    txRead: number;
    txUsed: number;
    positionsProduced: number;
    positionsZeroNetDropped: number;
    anomalyCount: number;
  };
}
// #endregion

interface FifoLayer {
  qty: number;
  price: number;
  ts: number;
}

import { getCumulativeSplitFactor, SplitEvent, DEFAULT_STOCK_SPLITS } from './stock-splits';

// [DEBUG] Prove Deployment
if (typeof window !== 'undefined') {
  console.log("%c FIFO Logic: Loaded with AssetType Isolation (Fix Active - v2026-01-30)", "background: #222; color: #bada55");
}

/**
 * Derives a holdings snapshot from a list of transactions using FIFO logic.
 * This is a pure function with no side effects or I/O.
 * @param transactions An array of raw transaction objects.
 * @param targetDate Optional. If set, only apply splits effective on or before this date.
 * @param activeSplits Optional. List of split events to use. Defaults to standard configuration.
 * @returns A snapshot of current holdings.
 */
export function buildHoldingsSnapshot(
  transactions: Tx[],
  targetDate?: string,
  activeSplits: SplitEvent[] = DEFAULT_STOCK_SPLITS
): Snapshot {
  const audit = {
    txRead: transactions.length,
    txUsed: 0,
    positionsProduced: 0,
    positionsZeroNetDropped: 0,
    anomalyCount: 0,
  };

  const anomalies: Map<string, string[]> = new Map();
  const recordAnomaly = (key: string, message: string) => {
    const k = (key || '').toUpperCase();
    if (!anomalies.has(k)) anomalies.set(k, []);
    anomalies.get(k)!.push(message);
    audit.anomalyCount++;
  };

  // 1. Normalize and filter transactions
  const validTxs = transactions
    .map((tx, i) => {
      const key = (tx.symbol || `tx_${i}`).toUpperCase();

      // [DATA-TRACE]
      const isTarget = tx.id === 'gCpvRarfPZYGV84UaLu1' || (tx as any).clientId === 'gCpvRarfPZYGV84UaLu1';

      if (
        !tx.symbol ||
        typeof tx.qty !== 'number' ||
        typeof tx.price !== 'number' ||
        typeof tx.transactionTimestamp !== 'number'
      ) {
        if (isTarget) console.error(`[DATA-TRACE] Target ${key} DROPPED: Missing fields`, tx);
        recordAnomaly(key, `Missing required field (symbol/qty/price/ts)`);
        return null;
      }

      const assetType: AssetType = tx.assetType || 'stock';
      if (!tx.assetType) recordAnomaly(key, 'assumed:stock');

      // [FIX] Ignore explicit SPLIT transactions
      if (tx.opKind === 'SPLIT') {
        // [DATA-TRACE]
        if (isTarget) console.error(`[DATA-TRACE] Target ${key} DROPPED: OpKind is SPLIT`, tx);
        return null;
      }

      const side: SideTx = tx.side || (tx.qty > 0 ? 'BUY' : 'SELL');
      if (!tx.side) recordAnomaly(key, 'side_inferred_from_qty');

      let qty = tx.qty;
      // [FIX] Strict Side adherence: If Side is BUY, force positive Qty. If SELL, force negative.
      // This respects the explicit 'side' field over the sign of 'qty'.
      if (side === 'BUY') {
        qty = Math.abs(qty);
      } else if (side === 'SELL') {
        qty = -Math.abs(qty);
      }

      const multiplier = tx.multiplier ?? (assetType === 'option' ? 100 : 1);

      // —— 在进入 FIFO 之前按“股票拆分事件”统一口径（Split-Adjusted Quantity/Price，拆分统一后的数量/价格）——
      let adjQty = qty;
      let adjPrice = tx.price;
      const splitFactor = getCumulativeSplitFactor(tx.symbol, tx.transactionTimestamp, targetDate, activeSplits);

      if (splitFactor !== 1) {
        adjQty = qty * splitFactor;
        adjPrice = tx.price / splitFactor;
        recordAnomaly(
          key,
          `split_adjusted:factor=${splitFactor}, orig_qty=${qty}, orig_price=${tx.price}`,
        );
      }

      let ts = tx.transactionTimestamp;
      if (typeof ts !== 'number' || isNaN(ts)) {
        // [CRITICAL FIX] Fallback for invalid timestamps to prevent silent drops
        // Try to parse string date if available? 
        // For now, if it's missing, default to 0 (oldest) or Date.now() (newest)?
        // Let's perform a salvage attempt
        if (isTarget) console.warn(`[DATA-TRACE] Target ${key} has INVALID timestamp: ${ts}. Salvaging...`);
        recordAnomaly(key, `Invalid timestamp: ${ts}, defaulted to 0`);
        ts = 0;
      }

      if (isTarget) {
        console.log(`[DATA-TRACE] Target ${key} PASSED Normalization.`, {
          origQty: tx.qty,
          adjQty,
          assetType,
          side,
          symbol: tx.symbol.toUpperCase(),
          ts
        });
      }

      return {
        ...tx,
        symbol: tx.symbol.toUpperCase(),
        assetType,
        side,
        qty: adjQty,
        price: adjPrice,
        multiplier,
        transactionTimestamp: ts
      };
    })
    .filter((tx): tx is NonNullable<typeof tx> => tx !== null);

  audit.txUsed = validTxs.length;

  // 2. Group by 合约身份（期权用 contractKey，其它用规范化 symbol）
  const groups = new Map<string, typeof validTxs>();
  for (const tx of validTxs) {
    const assetType = tx.assetType;
    const isOption = assetType === 'option' || tx.isOption === true;

    // [FIX] Normalize symbol by removing spaces for aggregation
    // This allows "NKE 260109 C 65" and "NKE260109C65" to group together.
    const normalizedSymbolForAgg = tx.symbol.toUpperCase().replace(/\s+/g, '');

    // [CRITICAL FIX] Always use the normalized symbol for grouping.
    const groupKeyBase = normalizedSymbolForAgg;

    // [FIX] Group by Symbol AND Asset Type to prevents "BA Option" polluting "BA Stock".
    // We utilize the boolean isOption derived above.
    const typeKey = isOption ? 'OPT' : 'STK';
    const key = `${groupKeyBase}|${typeKey}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const holdings: Holding[] = [];

  // 3. Process each group with FIFO logic
  for (const [key, txsInGroup] of groups.entries()) {
    // Key format: SYMBOL|TYPE

    // Sort first
    txsInGroup.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    const lastTx = txsInGroup[txsInGroup.length - 1];
    // Use the normalized symbol from the group logic, not just the last execution
    const symbol = lastTx.symbol.toUpperCase().replace(/\s+/g, '');

    // Determine Asset Type for the whole group
    // Since we grouped by type, we can check the first item (or any item)
    const isOptionGroup = key.endsWith('|OPT');

    // [CRITICAL FIX] Respect the isOption flag. Do NOT force downgrade to stock just because regex fails.
    // Only use Regex to *confirm* OCC if needed, but if input says Option, it is Option.
    const assetType: AssetType = isOptionGroup ? 'option' : 'stock';

    // Force Multiplier based on Asset Type Integrity
    // If it's a Stock, Multiplier MUST be 1. 
    // If Option, use the Transaction's multiplier (usually 100).
    const multiplier = assetType === 'stock' ? 1 : (txsInGroup[0].multiplier ?? 100);

    const longLayers: FifoLayer[] = [];
    const shortLayers: FifoLayer[] = [];
    let realizedPnl = 0; // 累计已实现盈亏

    for (const tx of txsInGroup) {
      if (tx.side === 'BUY') {
        let buyQty = tx.qty;
        // 先平掉空头
        while (buyQty > 0 && shortLayers.length > 0) {
          const shortLayer = shortLayers[0];
          const coverQty = Math.min(buyQty, Math.abs(shortLayer.qty));

          // 平空头盈亏 = (开仓价 - 平仓价) * 数量 * multiplier
          // [FIX] Use the unified group multiplier
          const pnl = (shortLayer.price - tx.price) * coverQty * multiplier;
          realizedPnl += pnl;

          shortLayer.qty += coverQty;
          buyQty -= coverQty;
          if (shortLayer.qty === 0) shortLayers.shift();
        }
        // 剩余部分开多头
        if (buyQty > 0) {
          longLayers.push({
            qty: buyQty,
            price: tx.price,
            ts: tx.transactionTimestamp,
          });
        }
      } else {
        // SELL（卖出）
        let sellQty = Math.abs(tx.qty);
        // 先平多头
        while (sellQty > 0 && longLayers.length > 0) {
          const longLayer = longLayers[0];
          const closeQty = Math.min(sellQty, longLayer.qty);

          // 平多头盈亏 = (卖出价 - 持仓价) * 数量 * multiplier
          // [FIX] Use the unified group multiplier
          const pnl = (tx.price - longLayer.price) * closeQty * multiplier;
          realizedPnl += pnl;

          longLayer.qty -= closeQty;
          sellQty -= closeQty;
          if (longLayer.qty === 0) longLayers.shift();
        }
        // 剩余部分开空头
        if (sellQty > 0) {
          shortLayers.push({
            qty: -sellQty,
            price: tx.price,
            ts: tx.transactionTimestamp,
          });
        }
      }
    }

    const netQty =
      longLayers.reduce((sum, l) => sum + l.qty, 0) +
      shortLayers.reduce((sum, s) => sum + s.qty, 0);

    if (netQty === 0) {
      audit.positionsZeroNetDropped++;
      continue;
    }

    const isLong = netQty > 0;
    const relevantLayers = isLong ? longLayers : shortLayers;
    // const multiplier = txsInGroup[0].multiplier; // Calculated above

    const costBasis = relevantLayers.reduce((sum, layer) => {
      // [FIX] REMOVE Math.abs. Ensure costBasis has the same sign as netQty.
      // Long: qty > 0, price > 0 -> costBasis > 0
      // Short: qty < 0, price > 0 -> costBasis < 0
      return sum + layer.qty * layer.price * multiplier;
    }, 0);

    const costPerUnit = Math.abs(costBasis) / (Math.abs(netQty) * multiplier);

    const lastTxTs = Math.max(...relevantLayers.map((l) => l.ts));

    holdings.push({
      symbol,
      assetType,
      netQty,
      multiplier,
      costBasis,
      costPerUnit,
      realizedPnl, // 新增字段
      side: isLong ? 'LONG' : 'SHORT',
      lastTxNy: toNyCalendarDayString(new Date(lastTxTs)),
      nowPrice: null,
      plFloating: '--',
      status: 'calc_pending',
      anomalies: anomalies.get(symbol.toUpperCase()) || [],
      lots: relevantLayers, // [New]
    });
    audit.positionsProduced++;
  }

  return { holdings, audit };
}
