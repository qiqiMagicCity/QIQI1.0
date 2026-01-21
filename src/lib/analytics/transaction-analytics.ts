import { getISOWeek, format as dateFormat } from "date-fns";
import { Tx } from "@/hooks/use-user-transactions";
import { isNyTradingDay } from "@/lib/ny-time";

export interface TransactionStats {
    pnl: { weekly: any[]; monthly: any[]; yearly: any[] } | null;
    value: { weekly: any[]; monthly: any[]; yearly: any[] } | null;
    efficiency: { weekly: any[]; monthly: any[]; yearly: any[] } | null;
    scatter: any[];
    daily: any[];
}

export function calculateTransactionStats(
    dailyPnlList: any[] | undefined, // Accepting DailyPnlResult objects now
    transactions: Tx[] | undefined
): TransactionStats {
    // 1. Prepare Daily Data Map (Date -> { pnl, tradingValue, ticketCount })
    const map = new Map<string, { pnl: number; tradingValue: number; ticketCount: number }>();

    // Fill PnL (Using totalPnl for Combined View consistency)
    if (dailyPnlList) {
        dailyPnlList.forEach(item => {
            const val = typeof item.totalPnl === 'number' ? item.totalPnl : (item.pnl || 0);
            const current = map.get(item.date) || { pnl: 0, tradingValue: 0, ticketCount: 0 };
            map.set(item.date, { ...current, pnl: val });
        });
    }

    // Fill Trading Value & Ticket Count
    if (transactions) {
        transactions.forEach(tx => {
            if (!['BUY', 'SELL', 'SHORT', 'COVER'].includes(tx.opKind)) return;
            const date = new Date(tx.transactionTimestamp).toISOString().substring(0, 10);
            const val = Math.abs(tx.price * tx.qty * (tx.multiplier || 1));

            const current = map.get(date) || { pnl: 0, tradingValue: 0, ticketCount: 0 };
            map.set(date, {
                ...current,
                tradingValue: current.tradingValue + val,
                ticketCount: current.ticketCount + 1
            });
        });
    }

    const dailyItems = Array.from(map.entries()).map(([date, d]) => ({ date, ...d }));

    // [FIX] Filter for Trading Days Only
    const validItems = dailyItems.filter(item => isNyTradingDay(item.date));

    if (validItems.length === 0) return { pnl: null, value: null, efficiency: null, scatter: [], daily: [] };

    // Calculate Global Median Trading Value for Quadrant Threshold
    const allTradingValues = validItems.map(d => d.tradingValue).filter(v => v > 0).sort((a, b) => a - b);
    const medianTradingValue = allTradingValues.length > 0
        ? allTradingValues[Math.floor(allTradingValues.length / 2)]
        : 0;

    // Helper to group and average
    const aggregate = (keyFn: (d: string) => string) => {
        const groups = new Map<string, { sumPnl: number; sumValue: number; count: number; sumTickets: number }>();

        validItems.forEach(item => {
            const key = keyFn(item.date);
            const current = groups.get(key) || { sumPnl: 0, sumValue: 0, count: 0, sumTickets: 0 };
            groups.set(key, {
                sumPnl: current.sumPnl + item.pnl,
                sumValue: current.sumValue + item.tradingValue,
                count: current.count + 1,
                sumTickets: current.sumTickets + item.ticketCount
            });
        });

        return Array.from(groups.entries())
            .map(([label, { sumPnl, sumValue, count, sumTickets }]) => {
                const avgPnl = sumPnl / count;
                const avgValue = sumValue / count;
                const avgTickets = sumTickets / count;

                // Efficiency: ROI % (Daily PnL / Daily Volume * 100)
                // Use sums to weight by volume? Or average of ratios? 
                // "Daily Account Growth %" -> usually Average Daily ROI.
                // Let's use (Sum PnL / Sum Volume) * 100 for proper weighted ROI over the period, 
                // OR Average of (Daily PnL / Daily Volume)?
                // Standard for "Efficiency" bar chart is usually per period outcome.
                // Let's stick to (Sum PnL / Sum Volume) * 100 for now as 'Period ROI on Turnover'.
                const efficiency = sumValue > 0 ? (sumPnl / sumValue) * 100 : 0;

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
                    avgTickets,
                    quadrant
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    };

    const weekly = aggregate((dateStr) => {
        // [FIX] Strict Trading Year Cutoff:
        // Even if ISO Week 01 spans Dec 29 - Jan 4, we MUST split it at Jan 1.
        // Days in 2025 belong to 2025 stats (e.g. 2025-W53).
        // Days in 2026 belong to 2026 stats (e.g. 2026-W01).

        // Safe parsing of YYYY-MM-DD to avoid Timezone shifts
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);

        const calYear = y; // Calendar Year from string
        const isoWeek = getISOWeek(dateObj);
        const isoYear = parseInt(dateFormat(dateObj, 'RRRR'));

        // If Calendar Year != ISO Year, it means we are in a straddle week (Start or End of Year)
        if (calYear !== isoYear) {
            // Case A: End of Year (e.g. Dec 31, 2025 is in W01 of 2026)
            // We force it into a "Week 53" bucket of the Calendar Year to keep it in 2025 view.
            if (calYear < isoYear) {
                return `${calYear}-W53`;
            }
            // Case B: Start of Year (e.g. Jan 1, 2027 is in W53 of 2026) -> Very rare with ISO rules
            // We force it into "Week 01" of the Calendar Year to keep it in 2027 view.
            if (calYear > isoYear) {
                return `${calYear}-W01`;
            }
        }

        // Normal Case: Return ISO Week string (e.g., 2026-W01)
        return `${calYear}-W${isoWeek.toString().padStart(2, '0')}`;
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
        daily: validItems.map(item => ({
            date: item.date,
            pnl: item.pnl,
            tradingValue: item.tradingValue,
            ticketCount: item.ticketCount,
            // Calculate quadrant for daily items too if needed, or leave for UI
            quadrant: ""
        })),
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
        scatter // Retain weekly scatter for backward compatibility if used elsewhere, or we can replace it.
        // But for now, let's just add 'daily' and handle the logic in the component.
    };
}

