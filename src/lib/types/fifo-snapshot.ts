
export interface FifoLot {
    qty: number;
    cost: number;
    date: string; // YYYY-MM-DD
    multiplier: number;
}

export interface FifoSnapshot {
    date: string; // YYYY-MM-DD
    timestamp: number; // Cut-off timestamp (exclusive for next run)
    version: string;
    inventory: Record<string, FifoLot[]>; // Symbol -> Lots
    metrics: {
        realizedPnl_Lifetime: number;
        winCount: number;
        lossCount: number;
    };
}
