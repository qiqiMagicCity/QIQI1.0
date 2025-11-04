
import { toNyCalendarDayString } from '@/lib/ny-time';

// #region: Type Definitions
export type AssetType = 'stock' | 'option';
export type SideTx = 'BUY' | 'SELL';

export interface Tx {
  symbol: string;
  assetType?: AssetType;
  side?: SideTx;
  qty: number;
  price: number;
  multiplier?: number;
  transactionTimestamp: number; // UTC milliseconds
}

export interface Holding {
  symbol: string;
  assetType: AssetType;
  netQty: number;
  multiplier: number;
  costBasis: number;
  costPerUnit: number;
  side: 'LONG' | 'SHORT';
  lastTxNy: string;
  nowPrice: null;
  plFloating: "--";
  status: 'calc_pending';
  anomalies: string[];
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

/**
 * Derives a holdings snapshot from a list of transactions using FIFO logic.
 * This is a pure function with no side effects or I/O.
 * @param transactions An array of raw transaction objects.
 * @returns A snapshot of current holdings.
 */
export function buildHoldingsSnapshot(transactions: Tx[]): Snapshot {
  const audit = {
    txRead: transactions.length,
    txUsed: 0,
    positionsProduced: 0,
    positionsZeroNetDropped: 0,
    anomalyCount: 0,
  };

  const anomalies: Map<string, string[]> = new Map();
  const recordAnomaly = (key: string, message: string) => {
    if (!anomalies.has(key)) anomalies.set(key, []);
    anomalies.get(key)!.push(message);
    audit.anomalyCount++;
  };

  // 1. Normalize and filter transactions
  const validTxs = transactions
    .map((tx, i) => {
      const key = tx.symbol || `tx_${i}`;
      if (!tx.symbol || typeof tx.qty !== 'number' || typeof tx.price !== 'number' || typeof tx.transactionTimestamp !== 'number') {
        recordAnomaly(key, `Missing required field (symbol/qty/price/ts)`);
        return null;
      }
      
      const assetType: AssetType = tx.assetType || 'stock';
      if (!tx.assetType) recordAnomaly(key, "assumed:stock");

      const side: SideTx = tx.side || (tx.qty > 0 ? 'BUY' : 'SELL');
      if (!tx.side) recordAnomaly(key, "side_inferred_from_qty");

      let qty = tx.qty;
      if ((side === 'BUY' && qty < 0) || (side === 'SELL' && qty > 0)) {
        recordAnomaly(key, `qty_sign_mismatch: side=${side}, qty=${qty}. Normalizing SELL to negative.`);
        if (side === 'SELL') qty = -Math.abs(qty);
      }
      
      const multiplier = tx.multiplier ?? (assetType === 'option' ? 100 : 1);

      return {
        ...tx,
        symbol: tx.symbol.toUpperCase(),
        assetType,
        side,
        qty,
        multiplier,
      };
    })
    .filter((tx): tx is NonNullable<typeof tx> => tx !== null);

  audit.txUsed = validTxs.length;

  // 2. Group by (symbol, assetType)
  const groups = new Map<string, typeof validTxs>();
  for (const tx of validTxs) {
    const key = `${tx.symbol}|${tx.assetType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const holdings: Holding[] = [];

  // 3. Process each group with FIFO logic
  for (const [key, txsInGroup] of groups.entries()) {
    txsInGroup.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

    const longLayers: FifoLayer[] = [];
    const shortLayers: FifoLayer[] = [];

    for (const tx of txsInGroup) {
      if (tx.side === 'BUY') {
        let buyQty = tx.qty;
        // First, cover any short positions
        while (buyQty > 0 && shortLayers.length > 0) {
          const shortLayer = shortLayers[0];
          const coverQty = Math.min(buyQty, Math.abs(shortLayer.qty));
          shortLayer.qty += coverQty;
          buyQty -= coverQty;
          if (shortLayer.qty === 0) shortLayers.shift();
        }
        // Any remaining buy quantity opens a new long position
        if (buyQty > 0) {
          longLayers.push({ qty: buyQty, price: tx.price, ts: tx.transactionTimestamp });
        }
      } else { // SELL
        let sellQty = Math.abs(tx.qty);
        // First, close any long positions
        while (sellQty > 0 && longLayers.length > 0) {
          const longLayer = longLayers[0];
          const closeQty = Math.min(sellQty, longLayer.qty);
          longLayer.qty -= closeQty;
          sellQty -= closeQty;
          if (longLayer.qty === 0) longLayers.shift();
        }
        // Any remaining sell quantity opens a new short position
        if (sellQty > 0) {
          shortLayers.push({ qty: -sellQty, price: tx.price, ts: tx.transactionTimestamp });
        }
      }
    }

    const netQty = longLayers.reduce((sum, l) => sum + l.qty, 0) + shortLayers.reduce((sum, s) => sum + s.qty, 0);

    if (netQty === 0) {
      audit.positionsZeroNetDropped++;
      continue;
    }
    
    const [symbol, assetTypeStr] = key.split('|');
    const assetType = assetTypeStr as AssetType;
    const isLong = netQty > 0;
    const relevantLayers = isLong ? longLayers : shortLayers;
    const multiplier = txsInGroup[0].multiplier;

    const costBasis = relevantLayers.reduce((sum, layer) => {
        return sum + Math.abs(layer.qty) * layer.price * multiplier;
    }, 0);

    const costPerUnit = costBasis / (Math.abs(netQty) * multiplier);
    
    const lastTxTs = Math.max(...relevantLayers.map(l => l.ts));

    holdings.push({
      symbol,
      assetType,
      netQty,
      multiplier,
      costBasis,
      costPerUnit,
      side: isLong ? 'LONG' : 'SHORT',
      lastTxNy: toNyCalendarDayString(new Date(lastTxTs)),
      nowPrice: null,
      plFloating: "--",
      status: 'calc_pending',
      anomalies: anomalies.get(symbol) || [],
    });
    audit.positionsProduced++;
  }

  return { holdings, audit };
}
