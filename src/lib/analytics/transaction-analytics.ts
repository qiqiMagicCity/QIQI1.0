import { getISOWeek } from "date-fns";
import { Tx } from "@/hooks/use-user-transactions";

export interface TransactionStats {
    pnl: { weekly: any[]; monthly: any[]; yearly: any[] } | null;
    value: { weekly: any[]; monthly: any[]; yearly: any[] } | null;
    efficiency: { weekly: any[]; monthly: any[]; yearly: any[] } | null;
    scatter: any[];
}

export function calculateTransactionStats(
    dailyPnlList: { date: string; pnl: number }[] | undefined,
    transactions: Tx[] | undefined
): TransactionStats {
    // 1. Prepare Daily Data Map (Date -> { pnl, tradingValue })
    const map = new Map<string, { pnl: number; tradingValue: number }>();

    // Fill PnL
    if (dailyPnlList) {
        dailyPnlList.forEach(item => {
            const current = map.get(item.date) || { pnl: 0, tradingValue: 0 };
            map.set(item.date, { ...current, pnl: item.pnl });
        });
    }

    // Fill Trading Value
    if (transactions) {
        transactions.forEach(tx => {
            if (!['BUY', 'SELL', 'SHORT', 'COVER'].includes(tx.opKind)) return;
            const date = new Date(tx.transactionTimestamp).toISOString().substring(0, 10);
            const val = Math.abs(tx.price * tx.qty * (tx.multiplier || 1));

            const current = map.get(date) || { pnl: 0, tradingValue: 0 };
            map.set(date, { ...current, tradingValue: current.tradingValue + val });
        });
    }

    const dailyItems = Array.from(map.entries()).map(([date, d]) => ({ date, ...d }));
    if (dailyItems.length === 0) return { pnl: null, value: null, efficiency: null, scatter: [] };

    // Calculate Global Median Trading Value for Quadrant Threshold
    const allTradingValues = dailyItems.map(d => d.tradingValue).filter(v => v > 0).sort((a, b) => a - b);
    const medianTradingValue = allTradingValues.length > 0
        ? allTradingValues[Math.floor(allTradingValues.length / 2)]
        : 0;

    // Helper to group and average
    const aggregate = (keyFn: (d: string) => string) => {
        const groups = new Map<string, { sumPnl: number; sumValue: number; count: number }>();

        dailyItems.forEach(item => {
            const key = keyFn(item.date);
            const current = groups.get(key) || { sumPnl: 0, sumValue: 0, count: 0 };
            groups.set(key, {
                sumPnl: current.sumPnl + item.pnl,
                sumValue: current.sumValue + item.tradingValue,
                count: current.count + 1
            });
        });

        return Array.from(groups.entries())
            .map(([label, { sumPnl, sumValue, count }]) => {
                const avgPnl = sumPnl / count;
                const avgValue = sumValue / count;
                // Efficiency: PnL per 10,000 USD Traded
                const efficiency = sumValue > 0 ? (sumPnl / sumValue) * 10000 : 0;

                // Quadrant Logic
                let quadrant = "";
                const isHighFunds = avgValue > medianTradingValue;
                const isHighReturn = avgPnl > 0;

                if (isHighFunds && isHighReturn) quadrant = "High Funds High Return";
                else if (isHighFunds && !isHighReturn) quadrant = "High Funds Low Return";
                else if (!isHighFunds && isHighReturn) quadrant = "Low Funds High Return";
                else quadrant = "Low Funds Low Return";

                return {
                    label,
                    avgPnl,
                    avgValue,
                    efficiency,
                    quadrant
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    };

    const weekly = aggregate((date) => {
        const d = new Date(date);
        const year = d.getFullYear();
        const week = getISOWeek(d);
        return `${year}-W${week.toString().padStart(2, '0')}`;
    });

    const monthly = aggregate((date) => date.substring(0, 7));
    const yearly = aggregate((date) => date.substring(0, 4));

    // Format for Charts
    const format = (list: any[], key: string) => list.map(item => ({
        label: item.label,
        value: item[key],
        quadrant: item.quadrant
    }));

    // Scatter Data (Weekly)
    const scatter = weekly.map(item => ({
        x: item.avgValue,
        y: item.avgPnl,
        label: item.label,
        quadrant: item.quadrant
    }));

    return {
        pnl: {
            weekly: format(weekly, 'avgPnl'),
            monthly: format(monthly, 'avgPnl'),
            yearly: format(yearly, 'avgPnl')
        },
        value: {
            weekly: format(weekly, 'avgValue'),
            monthly: format(monthly, 'avgValue'),
            yearly: format(yearly, 'avgValue')
        },
        efficiency: {
            weekly: format(weekly, 'efficiency'),
            monthly: format(monthly, 'efficiency'),
            yearly: format(yearly, 'efficiency')
        },
        scatter
    };
}
