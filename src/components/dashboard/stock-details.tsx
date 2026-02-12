"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHoldings } from "@/hooks/use-holdings";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from "recharts";
import { CumulativePnlChart } from "./cumulative-pnl-chart";
import { DailyPnlChart } from "./daily-pnl-chart";
import { DailyPnlCalendar } from "./daily-pnl-calendar";
import { CompanyLogo } from "@/components/common/company-logo";
import { AverageStatsChart } from "./average-stats-chart";
import { ScatterStatsChart } from "./scatter-stats-chart";
import { ProfitLossRatioChart } from "./profit-loss-ratio-chart";
import { calculateTransactionStats } from "@/lib/analytics/transaction-analytics";
import { buildHoldingsSnapshot } from '@/lib/holdings/fifo';
import { getRestoredHistoricalPrice } from '@/lib/holdings/stock-splits';
import { getPeriodStartDates, prevNyTradingDayString } from '@/lib/ny-time';

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


  const {
    rows: holdings,
    loading,
    historicalPnl,
    dailyPnlResults,
    pnlEvents,
    transactions,
    analysisYear,
    setAnalysisYear,
    ytdBaseEodMap,
    activeSplits,
    availableYears: providerYears // [NEW] From Provider
  } = useHoldings();

  // const { data: transactions } = useUserTransactions(user?.uid); // [REMOVED] Raw fetch ignores Time Travel
  const [activeIndex, setActiveIndex] = useState(0);
  const [leaderboardScope, setLeaderboardScope] = useState<'global' | 'yearly'>('global');

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

  const leaderboardData = useMemo(() => {
    // Determine Target Year Logic
    const currentYear = new Date().getFullYear();
    const targetYear = analysisYear || currentYear;
    const isGlobal = leaderboardScope === 'global';

    // [FIX] C4: Use strongly typed context (removed 'as any')
    const { auditTrail, historicalPnlMetrics } = useHoldings(); // Cast for now if interface not fully propagated in IDE

    const pnlMap = new Map<string, number>();

    // --- 1. Global View (Simple Lifetime Logic) ---
    if (isGlobal) {
      // Realized Lifetime (From Provider's Aggregation)
      historicalPnl.forEach(h => pnlMap.set(h.symbol, (pnlMap.get(h.symbol) || 0) + h.pnl));
      // Unrealized Current
      if (holdings) {
        holdings.forEach(h => pnlMap.set(h.symbol, (pnlMap.get(h.symbol) || 0) + (h.pnl || 0)));
      }
      return Array.from(pnlMap.entries()).map(([symbol, pnl]) => ({ symbol, pnl }));
    }

    // --- 2. Yearly View (Mark-to-Market Logic) ---
    // Formula: PnL_Year = Realized_Year + Unrealized_End - Unrealized_Start

    // A. Realized PnL (Sum of auditTrail in Target Year)
    const targetYearStr = String(targetYear);
    let yearlyInvalidCount = 0;

    if (auditTrail) {
      auditTrail.forEach((e) => {
        const d = e.closeDate; // AuditEvent uses closeDate
        if (d && d.startsWith(targetYearStr)) {
          // [FIX] C2: Explicit finite check
          if (Number.isFinite(e.pnl)) {
            pnlMap.set(e.symbol, (pnlMap.get(e.symbol) || 0) + e.pnl);
          } else {
            yearlyInvalidCount++;
          }
        }
      });
    }

    if (yearlyInvalidCount > 0) {
      console.warn(`[StockDetails] Skipped ${yearlyInvalidCount} invalid PnL entries for Yearly View ${targetYear}`);
    }


    // B. Unrealized End (From Current/Analysis Holdings)
    // Note: 'holdings' in context is already time-traveled to end of analysis year
    if (holdings) {
      holdings.forEach(h => {
        const val = pnlMap.get(h.symbol) || 0;
        pnlMap.set(h.symbol, val + (h.pnl || 0));
      });
    }

    // C. Unrealized Start (Subtract Start of Year Unrealized)
    // We need to calculate what the unrealized PnL was on Jan 1st (Start of Year).

    // c1. Determine "Start of Year" Date (Last trading day BEFORE Jan 1 technically, or Jan 1 open)
    // The ytdBaseEodMap corresponds to getPeriodBaseDates(today).ytd
    // Which is "End of Last Year". This is exactly what we want for "Start of This Year Values".

    // We need to rebuild holdings specifically at that date.
    // 'transactions' are filtered to end of year. We need to filter further to start of year.
    // Actually buildHoldingsSnapshot accepts a 'targetDate'.
    // We need the date string corresponding to ytdBaseEodMap.
    // Since we don't have the explicit date string from context, recover it.
    // Wait, ytdBaseEodMap items don't have date.
    // But we know it represents "Start of Analysis Year".
    // Let's deduce date: getPeriodBaseDates(effectiveDate).ytd

    // Wait, if analysisYear != currentYear, ytdBaseEodMap in context might be for CURRENT year?
    // Let's check HoldingsProvider again.
    // effectiveTodayNy depends on analysisYear.
    // fetchEod uses effectiveTodayNy.
    // So ytdBaseEodMap IS correct for analysisYear (i.e. Dec 31 of Prev Year).

    // Recover safe start date
    // Effectively: prevNyTradingDayString(targetYear + "-01-01")?
    // Or just use the targetDate logic.
    // Let's use `targetYear-01-01` as reference.
    // getPeriodBaseDates(`${targetYear}-01-01`)? No.
    // The base date for YTD is usually PrevYear-12-31.

    const startOfAnalysisYearDate = String(targetYear) + '-01-01'; // Nominal
    const { ytd: ytdStartDate } = getPeriodStartDates(startOfAnalysisYearDate); // Returns targetYear-01-01
    const ytdBaseDate = prevNyTradingDayString(ytdStartDate); // Returns PrevYear-12-31 (or similar)

    // c2. Snapshot at Start (using transactions filtered by buildHoldingsSnapshot internal logic)
    const { holdings: startHoldings } = buildHoldingsSnapshot(transactions || [], ytdBaseDate, activeSplits);

    // c3. Calculate Unrealized and Subtract
    startHoldings.forEach(h => {
      const symbol = h.symbol;
      // Lookup price in ytdBaseEodMap
      const eod = ytdBaseEodMap && ytdBaseEodMap[symbol] ? ytdBaseEodMap[symbol] : null; // Context uses raw symbol keys usually? No context rekeys... 
      // Wait, Context EOD maps are Record<NormalizedSymbol, Result>.
      // buildHoldingsSnapshot returns normalized UpperCase symbols.
      // Should match.

      let price = 0;
      if (eod && eod.status === 'ok' && eod.close != null) {
        // Restore Price!
        price = getRestoredHistoricalPrice(eod.close, symbol, ytdBaseDate, activeSplits);
      }

      if (price > 0 && h.netQty !== 0) {
        const mv = h.netQty * price * h.multiplier;
        const cost = h.costBasis; // Cost Basis at Start
        const unrealizedStart = mv - cost;

        // Subtract from Total
        const val = pnlMap.get(symbol) || 0;
        pnlMap.set(symbol, val - unrealizedStart);
      }
    });

    return Array.from(pnlMap.entries()).map(([symbol, pnl]) => ({ symbol, pnl }));

  }, [historicalPnl, holdings, pnlEvents, leaderboardScope, analysisYear, transactions, ytdBaseEodMap, activeSplits]);

  // --- Aggregation Logic ---
  // [PERFORMANCE] Memoize the input data for calculateTransactionStats to prevent unnecessary re-runs
  // [REVERT] Do NOT filter here. AverageStatsChart manages its own view filtering, 
  // ensuring Yearly Comparison has access to full history.
  const dailyPnlValues = useMemo(() => Object.values(dailyPnlResults || {}), [dailyPnlResults]);

  const stats = useMemo(() => {
    return calculateTransactionStats(dailyPnlValues, transactions);
  }, [dailyPnlValues, transactions]);

  const [statsMode, setStatsMode] = useState<'realized' | 'combined'>('combined');
  const [scatterDimension, setScatterDimension] = useState<'symbol' | 'day'>('day');

  // --- Available Years ---
  const availableYears = useMemo(() => {
    // Use Provider's comprehensive list if available
    if (providerYears && providerYears.length > 0) return providerYears;

    const years = new Set<number>();
    const current = new Date().getFullYear();
    years.add(current);
    if (pnlEvents) {
      pnlEvents.forEach((e: any) => {
        const d = e.closeDate || e.date;
        if (d) {
          const y = parseInt(d.substring(0, 4));
          if (!isNaN(y)) years.add(y);
        }
      });
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [pnlEvents, providerYears]);

  const displayedWinRateStats = useMemo(() => {
    // Re-calculate stats from events to support filtering
    // 1. Get Base Events (Realized) filtered by Year
    let events = pnlEvents || [];
    if (analysisYear) {
      const yStr = String(analysisYear);
      events = events.filter((e: any) => {
        const d = e.closeDate || e.date;
        return d && d.startsWith(yStr);
      });
    }

    // 2. Compute Realized Stats
    let winCount = 0;
    let lossCount = 0;
    let totalWin = 0;
    let totalLoss = 0;

    events.forEach((e: any) => {
      // Use strictly realized PnL from events
      const pnl = e.pnl;
      if (Math.abs(pnl) < 0.01) return;

      if (pnl > 0) {
        winCount++;
        totalWin += pnl;
      } else {
        lossCount++;
        totalLoss += Math.abs(pnl);
      }
    });

    // 3. Add Unrealized (if Combined Mode & Current Year/All)
    const currentYear = new Date().getFullYear();
    const isCurrentOrAll = !analysisYear || analysisYear === currentYear;

    if (statsMode === 'combined' && isCurrentOrAll && holdings) {
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
    }

    const avgWin = winCount > 0 ? totalWin / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
    const totalCount = winCount + lossCount;
    const winRate = totalCount > 0 ? winCount / totalCount : 0;
    const pnlRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    return {
      winRate,
      avgWin,
      avgLoss,
      pnlRatio,
      expectancy,
      winCount,
      lossCount
    };
  }, [pnlEvents, holdings, statsMode, analysisYear]);

  // --- Dimension: By Symbol ---
  const scatterBySymbol = useMemo(() => {
    const targetYearStr = analysisYear ? String(analysisYear) : null;
    const currentYear = new Date().getFullYear();
    const isCurrentOrAll = !analysisYear || analysisYear === currentYear;

    // 1. Get Realized PnL Map (Symbol -> PnL) for the Target Year
    const pnlMap = new Map<string, number>();

    // We must use pnlEvents to filter by date, historicalPnl is pre-aggregated lifetime stats.
    if (pnlEvents) {
      pnlEvents.forEach((e: any) => {
        // [FIX] AuditEvent uses 'closeDate', Legacy uses 'date'
        const dateStr = e.closeDate || e.date;
        if (!dateStr) return;

        if (targetYearStr && !dateStr.startsWith(targetYearStr)) return;

        // [FIX] AuditEvent has 'symbol'
        if (e.symbol) {
          pnlMap.set(e.symbol, (pnlMap.get(e.symbol) || 0) + e.pnl);
        }
      });
      // }).filter((d: any) => d.label.startsWith(String(analysisYear || ''))); // Simple filter at end?
      // Better to filter source:
      // const targetYearStr = analysisYear ? String(analysisYear) : null;
      // ...
    }

    // If Mode is Combined, add Unrealized PnL (Only for Current Year to avoid historical confusion)
    if (statsMode === 'combined' && isCurrentOrAll && holdings) {
      holdings.forEach(h => {
        const currentUnrealized = h.pnl || 0;
        const existing = pnlMap.get(h.symbol) || 0;
        pnlMap.set(h.symbol, existing + currentUnrealized);
      });
    }

    // 2. Get Trading Value Map (Symbol -> Total Value)
    const valMap = new Map<string, number>();
    if (transactions) {
      transactions.forEach(tx => {
        if (!['BUY', 'SELL', 'SHORT', 'COVER'].includes(tx.opKind)) return;

        // Filter by Year
        if (targetYearStr) {
          const txDate = new Date(tx.transactionTimestamp).toISOString().slice(0, 4);
          if (txDate !== targetYearStr) return;
        }

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
      // Mark as holding only if currently held
      const isHolding = holdings?.some(h => h.symbol === sym) ?? false;

      // Lower threshold to show more data in filtered views
      if (val > 1 || Math.abs(pnl) > 1) {
        result.push({
          x: val,
          y: pnl,
          label: sym,
          isHolding
        });
      }
    }
    return result;
  }, [pnlEvents, transactions, holdings, statsMode, analysisYear]);

  // --- Dimension: By Day ---
  const scatterByDay = useMemo(() => {
    if (!stats.daily) return [];

    const targetYearStr = analysisYear ? String(analysisYear) : null;
    // Pre-filter stats.daily by year
    const filteredDailyStats = targetYearStr
      ? stats.daily.filter((d: any) => d.date.startsWith(targetYearStr))
      : stats.daily;

    if (statsMode === 'realized') {
      const realizedMap = new Map<string, number>();
      (pnlEvents || []).forEach((e: any) => {
        const date = e.closeDate || e.date;
        if (date) realizedMap.set(date, (realizedMap.get(date) || 0) + e.pnl);
      });

      return filteredDailyStats.map((d: any) => {
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
    return filteredDailyStats.map((d: any) => {
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
  }, [stats.daily, statsMode, pnlEvents, analysisYear]);

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

  if (leaderboardData.length === 0 && (!transactions || transactions.length === 0)) {
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
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-lg font-medium text-zinc-200">
            排行榜 (Leaderboard)
            <span className="text-xs text-muted-foreground ml-2 font-normal">
              {leaderboardScope === 'global' ? '全历史 (Lifetime)' : `年度 (Year ${analysisYear || new Date().getFullYear()})`}
            </span>
          </h3>
          <div className="flex items-center gap-2 bg-zinc-900/50 p-1 rounded-lg border border-zinc-800">
            <Button
              variant={leaderboardScope === 'global' ? "secondary" : "ghost"}
              size="sm"
              className={`h-7 px-3 text-xs ${leaderboardScope === 'global' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              onClick={() => setLeaderboardScope('global')}
            >
              Global
            </Button>
            <div className="flex items-center">
              <Button
                variant={leaderboardScope === 'yearly' ? "secondary" : "ghost"}
                size="sm"
                className={`h-7 px-3 text-xs rounded-r-none border-r-0 ${leaderboardScope === 'yearly' ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/20' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => {
                  setLeaderboardScope('yearly');
                  if (!analysisYear) setAnalysisYear?.(new Date().getFullYear());
                }}
              >
                Yearly
              </Button>
              {leaderboardScope === 'yearly' && (
                <Select
                  value={String(analysisYear || new Date().getFullYear())}
                  onValueChange={(v: string) => setAnalysisYear?.(Number(v))}
                >
                  <SelectTrigger className="h-7 w-[70px] rounded-l-none border-l-0 bg-emerald-900/20 border-emerald-500/20 text-emerald-400 text-xs px-2 focus:ring-0 focus:ring-offset-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map(y => (
                      <SelectItem key={y} value={String(y)} className="text-xs">
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top 10 Winners (Total PnL) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-emerald-500 flex justify-between">
                <span>盈利 TOP 10</span>
                <span className="text-xs font-normal text-muted-foreground self-center opacity-70">
                  {leaderboardScope === 'global' ? 'All-Time' : `${analysisYear || new Date().getFullYear()}`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(() => {
                  const winners = leaderboardData.filter(h => h.pnl > 0).sort((a, b) => b.pnl - a.pnl);
                  // [FIX] C1, C2, C3: Diagnostic for truncation (Natural Scarcity OR Filtering)
                  if (process.env.NODE_ENV === 'development' && winners.length < 10) {
                    const candidates = leaderboardData.length;
                    const winCount = winners.length;
                    const filtered = candidates - winCount;
                    const scope = leaderboardScope === 'global' ? 'Global/Lifetime' : `Yearly(${analysisYear || new Date().getFullYear()})`;

                    console.info(`[Leaderboard] Winners Top10 truncated. Candidates: ${candidates}, Winners: ${winCount}, Filtered: ${filtered}, Scope: ${scope}`);
                  }
                  return winners.slice(0, 10).map((h) => (
                    <div key={h.symbol} className="flex justify-between items-center text-sm border-b border-border/50 last:border-0 pb-2 last:pb-0">
                      <span className="font-medium">{h.symbol}</span>
                      <span className="text-emerald-500 font-mono">
                        +${h.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ));
                })()}
                {leaderboardData.filter(h => h.pnl > 0).length === 0 && (
                  <p className="text-muted-foreground text-center py-4">暂无盈利记录</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top 10 Losers (Total PnL) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-rose-500 flex justify-between">
                <span>亏损 TOP 10</span>
                <span className="text-xs font-normal text-muted-foreground self-center opacity-70">
                  {leaderboardScope === 'global' ? 'All-Time' : `${analysisYear || new Date().getFullYear()}`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {leaderboardData
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
                {leaderboardData.filter(h => h.pnl < 0).length === 0 && (
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
          analysisYear={analysisYear}
          setAnalysisYear={setAnalysisYear}
          availableYears={availableYears}
        />
      </section>

      {/* Avg Trading Value (Replaces Volume) */}
      <section id="avg-value">
        <AverageStatsChart
          title="Avg. Trading Value / Day 平均每日成交金额 (成交额 / Turnover)"
          data={stats.value || { weekly: [], monthly: [], yearly: [] }}
          type="value"
          analysisYear={analysisYear}
          setAnalysisYear={setAnalysisYear}
          availableYears={availableYears}
        />
      </section>

      {/* Funds Efficiency (Refactored to ROI) */}
      <section id="efficiency">
        <AverageStatsChart
          title="Return on Volume % 交易量回报率 (PnL / TradingValue)"
          data={stats.efficiency || { weekly: [], monthly: [], yearly: [] }}
          type="efficiency"
          analysisYear={analysisYear}
          setAnalysisYear={setAnalysisYear}
          availableYears={availableYears}
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
          analysisYear={analysisYear}
          setAnalysisYear={setAnalysisYear}
          availableYears={availableYears}
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
          analysisYear={analysisYear}
          setAnalysisYear={setAnalysisYear}
          availableYears={availableYears}
        />
      </section>
    </div>
  );
}
