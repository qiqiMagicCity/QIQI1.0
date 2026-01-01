"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHoldings } from "@/hooks/use-holdings";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from "recharts";
import { CumulativePnlChart } from "./cumulative-pnl-chart";
import { DailyPnlChart } from "./daily-pnl-chart";
import { DailyPnlCalendar } from "./daily-pnl-calendar";
import { CompanyLogo } from "@/components/common/company-logo";
import { useUser } from "@/firebase";
import { useUserTransactions } from "@/hooks/use-user-transactions";
import { AverageStatsChart } from "./average-stats-chart";
import { ScatterStatsChart } from "./scatter-stats-chart";
import { ProfitLossRatioChart } from "./profit-loss-ratio-chart";
import { calculateTransactionStats } from "@/lib/analytics/transaction-analytics";

import { getISOWeek } from "date-fns";

// Vibrant color palette
const COLORS = [
  "#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8",
  "#82ca9d", "#ffc658", "#8dd1e1", "#a4de6c", "#d0ed57",
  "#ff7300", "#387908", "#3b4252", "#bf616a", "#d0ed57",
  "#ff7300", "#387908", "#3b4252", "#bf616a", "#d08770"
];

const renderActiveShape = (props: any) => {
  const RADIAN = Math.PI / 180;
  const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  const sin = Math.sin(-midAngle * RADIAN);
  const cos = Math.cos(-midAngle * RADIAN);
  const sx = cx + (outerRadius + 10) * cos;
  const sy = cy + (outerRadius + 10) * sin;
  const mx = cx + (outerRadius + 30) * cos;
  const my = cy + (outerRadius + 30) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 22;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  // Content Strings
  const line1 = `${payload.name} · ${(percent * 100).toFixed(1)}%`;
  const line2 = `市值: $${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Dynamic Sizing
  // Estimate width based on the longer line (approx 14px per char for 24px font)
  const maxLen = Math.max(line1.length, line2.length);
  const textWidth = maxLen * 14 + 48; // +48 for padding (x2)
  const boxHeight = 100; // Height for 2 lines (x2)

  // Position box based on text anchor
  // If anchor is 'start' (right side), box starts at ex + 12
  // If anchor is 'end' (left side), box starts at ex - 12 - textWidth
  let boxX = textAnchor === 'start' ? ex + 12 : ex - 12 - textWidth;
  let boxY = ey - boxHeight / 2;

  // Boundary Checks
  // Assume container is roughly centered at cx, cy. 
  // Width approx cx * 2, Height approx cy * 2.
  const containerW = cx * 2;
  const containerH = cy * 2;
  const padding = 10;

  // Horizontal Check
  if (boxX + textWidth > containerW - padding) {
    // Overflow Right: Shift left to fit
    boxX = containerW - textWidth - padding;
  }
  if (boxX < padding) {
    // Overflow Left: Shift right to fit
    boxX = padding;
  }

  // Vertical Check
  if (boxY < padding) {
    // Overflow Top
    boxY = padding;
  }
  if (boxY + boxHeight > containerH - padding) {
    // Overflow Bottom
    boxY = containerH - boxHeight - padding;
  }

  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 6}
        outerRadius={outerRadius + 10}
        fill={fill}
      />
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
      <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />

      {/* Tooltip Box: Black background with colored border */}
      <rect
        x={boxX}
        y={boxY}
        width={textWidth}
        height={boxHeight}
        rx={12}
        ry={12}
        fill="#000000"
        stroke={fill}
        strokeWidth={2}
        filter="drop-shadow(0px 4px 8px rgba(0,0,0,0.5))"
      />

      {/* Line 1: Symbol + Percent */}
      <text
        x={boxX + textWidth / 2}
        y={boxY + 40}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={26}
        fontWeight="bold"
      >
        {line1}
      </text>

      {/* Line 2: Market Value */}
      <text
        x={boxX + textWidth / 2}
        y={boxY + 76}
        textAnchor="middle"
        fill="#cccccc"
        fontSize={22}
        fontFamily="monospace"
      >
        {line2}
      </text>
    </g>
  );
};

export function StockDetails() {
  const { rows: holdings, loading, historicalPnl, dailyPnlList, dailyPnlResults, summary, pnlEvents } = useHoldings();
  const { user } = useUser();
  const { data: transactions } = useUserTransactions(user?.uid);
  const [activeIndex, setActiveIndex] = useState(0);

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index);
  };

  const data = useMemo(() => {
    if (!holdings) return [];
    return holdings
      .filter(h => h.mv && Math.abs(h.mv) > 1) // Filter out very small positions
      .map(h => ({
        name: h.symbol,
        value: Math.abs(h.mv || 0), // Use absolute value for distribution
        rawValue: h.mv // Keep raw value for tooltip if needed
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const combinedPnl = useMemo(() => {
    const pnlMap = new Map<string, number>();

    // 1. Add Realized PnL (from historicalPnl)
    historicalPnl.forEach(h => {
      pnlMap.set(h.symbol, h.pnl);
    });

    // 2. Add Unrealized PnL (from current holdings)
    if (holdings) {
      holdings.forEach(h => {
        const currentUnrealized = h.pnl || 0;
        const existing = pnlMap.get(h.symbol) || 0;
        pnlMap.set(h.symbol, existing + currentUnrealized);
      });
    }

    // 3. Convert to array
    return Array.from(pnlMap.entries()).map(([symbol, pnl]) => ({ symbol, pnl }));
  }, [historicalPnl, holdings]);

  // --- Aggregation Logic ---
  // [PERFORMANCE] Memoize the input data for calculateTransactionStats to prevent unnecessary re-runs
  const dailyPnlValues = useMemo(() => Object.values(dailyPnlResults || {}), [dailyPnlResults]);

  const stats = useMemo(() => {
    return calculateTransactionStats(dailyPnlValues, transactions);
  }, [dailyPnlValues, transactions]);

  const [statsMode, setStatsMode] = useState<'realized' | 'combined'>('combined');
  const [scatterDimension, setScatterDimension] = useState<'symbol' | 'day'>('day');

  const displayedWinRateStats = useMemo(() => {
    const base = summary?.winRateStats;
    if (statsMode === 'realized' || !base || !holdings) return base;

    let { winCount, lossCount, avgWin, avgLoss } = base;
    let totalWin = avgWin * winCount;
    let totalLoss = avgLoss * lossCount;

    holdings.forEach(h => {
      // Use h.pnl (Unrealized PnL)
      const pnl = h.pnl || 0;
      if (Math.abs(pnl) < 0.01) return; // Ignore near-zero PnL

      if (pnl > 0) {
        totalWin += pnl;
        winCount++;
      } else {
        totalLoss += Math.abs(pnl);
        lossCount++;
      }
    });

    const newAvgWin = winCount > 0 ? totalWin / winCount : 0;
    const newAvgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
    const totalCount = winCount + lossCount;
    const newWinRate = totalCount > 0 ? winCount / totalCount : 0;
    const newPnlRatio = newAvgLoss > 0 ? newAvgWin / newAvgLoss : 0;
    const newExpectancy = (newWinRate * newAvgWin) - ((1 - newWinRate) * newAvgLoss);

    return {
      winRate: newWinRate,
      avgWin: newAvgWin,
      avgLoss: newAvgLoss,
      pnlRatio: newPnlRatio,
      expectancy: newExpectancy,
      winCount,
      lossCount
    };
  }, [summary?.winRateStats, holdings, statsMode]);

  // --- Dimension: By Symbol ---
  const scatterBySymbol = useMemo(() => {
    // 1. Get PnL Map (Symbol -> PnL)
    const pnlMap = new Map<string, number>();

    if (statsMode === 'combined') {
      combinedPnl.forEach(item => pnlMap.set(item.symbol, item.pnl));
    } else {
      historicalPnl.forEach(h => pnlMap.set(h.symbol, h.pnl));
    }

    // 2. Get Trading Value Map (Symbol -> Total Value)
    const valMap = new Map<string, number>();
    if (transactions) {
      transactions.forEach(tx => {
        if (!['BUY', 'SELL', 'SHORT', 'COVER'].includes(tx.opKind)) return;
        const val = Math.abs(tx.price * tx.qty * (tx.multiplier || 1));
        const current = valMap.get(tx.symbol) || 0;
        valMap.set(tx.symbol, current + val);
      });
    }

    // 3. Merge
    const result = [];
    const allSymbols = new Set([...Array.from(pnlMap.keys()), ...Array.from(valMap.keys())]);

    for (const sym of allSymbols) {
      const val = valMap.get(sym) || 0;
      const pnl = pnlMap.get(sym) || 0;
      const isHolding = holdings?.some(h => h.symbol === sym);

      if (val > 10 || Math.abs(pnl) > 10) { // Filter noise
        result.push({
          x: val,
          y: pnl,
          label: sym,
          isHolding
        });
      }
    }
    return result;
  }, [combinedPnl, historicalPnl, transactions, holdings, statsMode]);

  // --- Dimension: By Day ---
  const scatterByDay = useMemo(() => {
    if (!stats.daily) return [];

    if (statsMode === 'realized') {
      const realizedMap = new Map<string, number>();
      (pnlEvents || []).forEach(e => {
        realizedMap.set(e.date, (realizedMap.get(e.date) || 0) + e.pnl);
      });

      return stats.daily.map((d: any) => {
        const pnl = realizedMap.get(d.date) || 0;
        const volume = d.tradingValue || 0;
        const roi = volume > 0 ? (pnl / volume) * 100 : 0;

        return {
          x: volume,
          y: roi, // Use ROI for Y-Axis
          z: d.ticketCount || 1, // Use Ticket Count for Bubble Size
          roi: roi,
          pnl: pnl,
          label: d.date,
          isHolding: false
        };
      }).filter((d: any) => d.x > 0 || Math.abs(d.pnl) > 0.01);
    }

    // Combined Mode
    return stats.daily.map((d: any) => {
      const pnl = d.pnl;
      const volume = d.tradingValue || 0;
      const roi = volume > 0 ? (pnl / volume) * 100 : 0;

      return {
        x: volume,
        y: roi, // Use ROI for Y-Axis
        z: d.ticketCount || 1, // Use Ticket Count for Bubble Size
        roi: roi,
        pnl: pnl,
        label: d.date,
        isHolding: false
      };
    }).filter((d: any) => d.x > 0 || Math.abs(d.pnl) > 0.01);
  }, [stats.daily, statsMode, pnlEvents]);

  const displayedScatter = useMemo(() => {
    if (scatterDimension === 'day') {
      return scatterByDay;
    }
    return scatterBySymbol;
  }, [scatterDimension, scatterByDay, scatterBySymbol]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (holdings?.length === 0 && (!transactions || transactions.length === 0)) {
    // Only show empty state if truly no data (no holdings AND no txs)
    // Existing check `if (data.length === 0)` was checking holdings pie chart data only.
    // We often have transactions even if no current holdings.
  }

  if (combinedPnl.length === 0 && (!transactions || transactions.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px] gap-4">
        <p className="text-muted-foreground">暂无持仓或交易数据</p>
      </div>
    );
  }
  // Remove "Debug Info" block for cleaner UI in production, or keep if user wanted debug.
  // Existing code had logic `if (data.length === 0)`. 
  // We keep the structure but allow rendering if we have stats even if Pie data is empty.

  return (
    <div className="space-y-6">
      <section id="holdings-distribution">
        <Card>
          <CardHeader>
            <CardTitle>持仓分布 (按市值)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.length > 0 ? (
              <div className="flex flex-col md:flex-row items-center gap-6 h-[400px]">
                {/* Left: Detailed List (Clickable Cards) - Grid Layout */}
                <div
                  className="w-full md:w-1/2 h-full overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 [&::-webkit-scrollbar]:hidden"
                >
                  {data.map((entry, index) => {
                    const isActive = activeIndex === index;
                    const totalValue = data.reduce((sum, item) => sum + item.value, 0);
                    const percent = totalValue > 0 ? (entry.value / totalValue) * 100 : 0;

                    return (
                      <Link
                        key={entry.name}
                        href={`/symbol/${entry.name}`}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border backdrop-blur-sm transition-all group cursor-pointer shadow-sm
                        ${isActive
                            ? 'bg-emerald-900/40 border-emerald-500/60'
                            : 'bg-emerald-950/20 border-emerald-500/30 hover:bg-emerald-900/30'
                          }`}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CompanyLogo symbol={entry.name} size={20} className="w-5 h-5 shrink-0" />
                          <span className="text-sm font-bold text-emerald-400 tracking-wide truncate">
                            {entry.name}
                          </span>
                        </div>
                        <span className="text-xl text-emerald-500 font-mono font-bold shrink-0">
                          {percent.toFixed(1)}%
                        </span>
                      </Link>
                    );
                  })}
                </div>

                {/* Right: Pie Chart with Hover Effect */}
                <div className="w-full md:w-1/2 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        activeIndex={activeIndex}
                        activeShape={renderActiveShape}
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={80} // Donut chart looks better with active shape
                        outerRadius={120}
                        fill="#8884d8"
                        dataKey="value"
                        onMouseEnter={onPieEnter}
                        stroke="none"
                      >
                        {data.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                当前无持仓
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section id="top-pnl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top 10 Winners (Total PnL) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-emerald-500">盈利 TOP 10</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {combinedPnl
                  .filter(h => h.pnl > 0)
                  .sort((a, b) => b.pnl - a.pnl)
                  .slice(0, 10)
                  .map((h) => (
                    <div key={h.symbol} className="flex justify-between items-center text-sm border-b border-border/50 last:border-0 pb-2 last:pb-0">
                      <span className="font-medium">{h.symbol}</span>
                      <span className="text-emerald-500 font-mono">
                        +${h.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                {combinedPnl.filter(h => h.pnl > 0).length === 0 && (
                  <p className="text-muted-foreground text-center py-4">暂无盈利记录</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top 10 Losers (Total PnL) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-rose-500">亏损 TOP 10</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {combinedPnl
                  .filter(h => h.pnl < 0)
                  .sort((a, b) => a.pnl - b.pnl) // Ascending for negative numbers (biggest loss first)
                  .slice(0, 10)
                  .map((h) => (
                    <div key={h.symbol} className="flex justify-between items-center text-sm border-b border-border/50 last:border-0 pb-2 last:pb-0">
                      <span className="font-medium">{h.symbol}</span>
                      <span className="text-rose-500 font-mono">
                        -${Math.abs(h.pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                {combinedPnl.filter(h => h.pnl < 0).length === 0 && (
                  <p className="text-muted-foreground text-center py-4">暂无亏损记录</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="daily-pnl">
        <div className="space-y-6">
          <DailyPnlChart />
          <CumulativePnlChart />
          <DailyPnlCalendar />
        </div>
      </section>

      {/* Avg PnL */}
      <section id="avg-pnl">
        <AverageStatsChart
          title="Avg. PnL / Day 平均每日盈亏 (含持仓 / Total PnL)"
          data={stats.pnl || { weekly: [], monthly: [], yearly: [] }}
          type="pnl"
        />
      </section>

      {/* Avg Trading Value (Replaces Volume) */}
      <section id="avg-value">
        <AverageStatsChart
          title="Avg. Trading Value / Day 平均每日成交金额 (成交额 / Turnover)"
          data={stats.value || { weekly: [], monthly: [], yearly: [] }}
          type="value"
        />
      </section>

      {/* Funds Efficiency (Refactored to ROI) */}
      <section id="efficiency">
        <AverageStatsChart
          title="Avg. Daily ROI % 平均每日回报率 (PnL / Volume)"
          data={stats.efficiency || { weekly: [], monthly: [], yearly: [] }}
          type="efficiency"
        />
      </section>

      {/* Correlation Scatter */}
      <section id="correlation">
        <ScatterStatsChart
          title="PnL vs Trading Value 盈亏与成交金额对照图"
          data={displayedScatter || []}
          mode={statsMode}
          onModeChange={setStatsMode}
          dimension={scatterDimension}
          onDimensionChange={setScatterDimension}
        />
      </section>

      {/* Profit / Loss Ratio */}
      <section id="pnl-ratio">
        <ProfitLossRatioChart
          stats={displayedWinRateStats || {
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            pnlRatio: 0,
            expectancy: 0,
            winCount: 0,
            lossCount: 0
          }}
          mode={statsMode}
          onModeChange={setStatsMode}
        />
      </section>
    </div>
  );
}
