import { toNyCalendarDayString } from '../ny-time';

// #region: Type Definitions
export type AssetType = 'stock' | 'option';
export type SideTx = 'BUY' | 'SELL' | 'NOTE';

export interface Tx {
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
            if (
                !tx.symbol ||
                typeof tx.qty !== 'number' ||
                typeof tx.price !== 'number' ||
                typeof tx.transactionTimestamp !== 'number'
            ) {
                recordAnomaly(key, `Missing required field (symbol/qty/price/ts)`);
                return null;
            }

            const assetType: AssetType = tx.assetType || 'stock';
            if (!tx.assetType) recordAnomaly(key, 'assumed:stock');

            // [FIX] Ignore explicit SPLIT transactions
            if (tx.opKind === 'SPLIT') return null;

            const side: SideTx = tx.side || (tx.qty > 0 ? 'BUY' : 'SELL');
            if (!tx.side) recordAnomaly(key, 'side_inferred_from_qty');

            let qty = tx.qty;
            if ((side === 'BUY' && qty < 0) || (side === 'SELL' && qty > 0)) {
                recordAnomaly(
                    key,
                    `qty_sign_mismatch: side=${side}, qty=${qty}. Normalizing SELL to negative.`,
                );
                if (side === 'SELL') qty = -Math.abs(qty);
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

            return {
                ...tx,
                symbol: tx.symbol.toUpperCase(),
                assetType,
                side,
                qty: adjQty,
                price: adjPrice,
                multiplier,
            };
        })
        .filter((tx): tx is NonNullable<typeof tx> => tx !== null);

    audit.txUsed = validTxs.length;

    // 2. Group by 合约身份（期权用 contractKey，其它用规范化 symbol）
    const groups = new Map<string, typeof validTxs>();
    for (const tx of validTxs) {
        const assetType = tx.assetType;
        const isOption = assetType === 'option' || tx.isOption === true;

        const normalizedSymbol = tx.symbol.toUpperCase();
        const groupKeyBase =
            isOption && tx.contractKey
                ? tx.contractKey
                : normalizedSymbol;

        // key 结构：groupKey|原始显示 symbol|assetType
        const key = `${groupKeyBase}|${tx.symbol}|${assetType}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(tx);
    }

    const holdings: Holding[] = [];

    // 3. Process each group with FIFO logic
    for (const [key, txsInGroup] of groups.entries()) {
        const [, symbol, assetTypeStr] = key.split('|');
        const assetType = assetTypeStr as AssetType;

        txsInGroup.sort((a, b) => a.transactionTimestamp - b.transactionTimestamp);

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
                    const pnl = (shortLayer.price - tx.price) * coverQty * (tx.multiplier ?? 1);
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
                    const pnl = (tx.price - longLayer.price) * closeQty * (tx.multiplier ?? 1);
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
        const multiplier = txsInGroup[0].multiplier;

        const costBasis = relevantLayers.reduce((sum, layer) => {
            return sum + Math.abs(layer.qty) * layer.price * multiplier;
        }, 0);

        const costPerUnit = costBasis / (Math.abs(netQty) * multiplier);

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
