
/**
 * Daily Portfolio Snapshot Definition
 * Represents the state of a single position at the end of a specific trading day.
 * Stored in Firestore collection: `users/{uid}/daily_snapshots/{date}_{symbol}`
 */

export interface DailyPositionSnapshot {
    // Composite Key: {date}_{symbol} (in filename/docId)

    date: string;       // YYYY-MM-DD (NY Trading Day)
    symbol: string;     // Normalized Symbol (Upper Case)

    // Position State
    quantity: number;           // Net signed quantity (positive = long, negative = short)
    costBasis: number;          // Total Cost Basis (for the entire quantity)
    realizedPnlLifetime: number;// Accumulated Realized PnL for this symbol since inception (or start of history)

    // Market Data at Snapshot Time
    closePrice: number;         // The price used for valuation (Usually Restored Historical Price)
    marketValue: number;        // formula: quantity * closePrice * multiplier

    // Metadata
    multiplier: number;         // 1 for stock, 100 for options usually
    assetType: 'stock' | 'option';
    currency: string;           // Usually 'USD'

    updatedAt: number;          // Server Timestamp (ms)
    source: 'auto-daily' | 'manual-recalc';
}

export interface DailyPortfolioSummary {
    date: string;
    totalMarketValue: number;
    totalCostBasis: number;
    totalRealizedPnlLifetime: number; // Sum of all positions
    totalUnrealizedPnl: number;       // Summary Field
    positionCount: number;
    updatedAt: number;
}
