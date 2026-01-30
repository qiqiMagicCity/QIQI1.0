// src/lib/ny-time.ts

// Unified New York "day" utilities.
// IMPORTANT: This is the ONLY allowed entrypoint to derive a "day" string used across the app.
// All "which day" questions must go through these helpers to satisfy GLOBAL_RULES.md 2.1.

type DateInput = Date | number | string;

const NY_TZ = 'America/New_York';

// formatToParts is locale-safe and DST-safe; we avoid toISOString()/toLocaleDateString() traps.
function getNyParts(input: DateInput) {
  const d = (input instanceof Date) ? input : new Date(input);
  // Defensive: invalid date guard
  if (isNaN(d.getTime())) throw new Error('[ny-time] Invalid Date input');

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const year = map.year ?? '';
  const month = map.month ?? '';
  const day = map.day ?? '';
  const hour = map.hour ?? '00';
  const minute = map.minute ?? '00';
  const second = map.second ?? '00';

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

// Returns NY calendar day string "YYYY-MM-DD" (NOT a trading-day decision).
// This is the lowest-level primitive; higher-level trading-day logic should build on top of this.
export function toNyCalendarDayString(input: DateInput): string {
  const p = getNyParts(input);
  const yyyy = String(p.year).padStart(4, '0');
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Options for trading-day mapping.
export type TradingDayOptions = {
  // If true, apply 09:30/16:00 session boundaries and holiday/weekend rules.
  // For now we leave it false by default and provide a placeholder implementation.
  applySessionRules?: boolean;
  // Inject a holiday/business-day lookup when we wire real trading calendar later.
  // Should return previous/next business day around a given NY calendar day.
  businessDayHelper?: {
    isBusinessDay: (yyyyMmDd: string) => boolean;
    previousBusinessDay: (yyyyMmDd: string) => string;
    nextBusinessDay: (yyyyMmDd: string) => string;
  };
};

// Returns NY "trading day" string "YYYY-MM-DD".
// Default behavior currently equals calendar day (safe & explicit).
// We deliberately DO NOT guess session boundaries without confirmed rules/data.
// Later we will enable applySessionRules with an injected businessDayHelper.
export function toNyTradingDayString(input: DateInput, opts: TradingDayOptions = {}): string {
  const { applySessionRules = false, businessDayHelper } = opts;
  const cal = toNyCalendarDayString(input);

  if (!applySessionRules) {
    return cal;
  }

  // Placeholder scaffold for future wiring (do not change current behavior without explicit confirmation):
  // 1) Use getNyParts to check local NY time hour/minute/second.
  // 2) If time < 09:30:00, map to previous business day.
  // 3) If time >= 16:00:00, typically remain same trading date (close stamped) — final rule TBD.
  // 4) Weekends/holidays map to the previous business day.
  // NOTE: This block intentionally throws until explicit rules + holiday helper are provided.
  throw new Error('[ny-time] applySessionRules=true requires confirmed trading calendar rules.');
}

// Helper to assert a YYYY-MM-DD day string (for storage/keys).
export function assertYyyyMmDd(s: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`[ny-time] Not a YYYY-MM-DD string: ${s}`);
  }
}

// Convenience: current NY calendar day string (diagnostics/UI only; do NOT cache globally).
export function nowNyCalendarDayString(): string {
  return toNyCalendarDayString(new Date());
}

export function toNyHmsString(input: DateInput): string {
  const p = getNyParts(input);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function toNyHm(input: DateInput): string {
  const p = getNyParts(input);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Formats a date into a HH:mm:ss string for an arbitrary time zone.
 * This is a general-purpose UI helper, intended for components like world clocks.
 * It uses the 'en-CA' locale to ensure a 24-hour format without AM/PM.
 * @param input The date to format.
 * @param timeZone The IANA time zone name (e.g., 'Europe/Madrid').
 * @returns A string in HH:mm:ss format.
 */
export function formatHmsForZone(input: DateInput, timeZone: string): string {
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return 'Invalid Date';

  const fmt = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timeZone,
  });

  const parts = fmt.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const hour = map.hour ?? '00';
  const minute = map.minute ?? '00';
  const second = map.second ?? '00';

  return `${hour}:${minute}:${second}`;
}

export function nyLocalDateTimeToUtcMillis(yyyyMmDd: string, hhmmss: string): number {
  assertYyyyMmDd(yyyyMmDd);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(hhmmss)) {
    throw new Error(`[ny-time] Not a HH:mm:ss string: ${hhmmss}`);
  }
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const [hh, mm, ss] = hhmmss.split(':').map(Number);

  const match = (ms: number) => {
    const p = getNyParts(ms);
    return p.year === y && p.month === m && p.day === d &&
      p.hour === hh && p.minute === mm && p.second === ss;
  };

  // 初始猜测（不带时区的 UTC 构造）
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  if (match(guess)) return guess;

  const ONE_MIN = 60_000;
  // 双向扩散搜索，覆盖 DST 前后
  for (let delta = 1; delta <= 24 * 60; delta++) {
    const plus = guess + delta * ONE_MIN;
    if (match(plus)) return plus;
    const minus = guess - delta * ONE_MIN;
    if (match(minus)) return minus;
  }
  throw new Error('[ny-time] Failed to map NY local time to UTC (likely an invalid local time due to DST).');
}

// 返回纽约时区的星期索引：0=周日 ... 6=周六
export function nyWeekdayIndex(input: Date | number | string): number {
  // Defensive normalization
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else {
    d = new Date(input);
  }

  if (isNaN(d.getTime())) return 0; // Fallback

  // 如果 input 已经是标准的 YYYY-MM-DD 字符串，我们可以直接构造 UTC Noon Date
  // 这比 generic Date parsing 更安全
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, day] = input.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
    return utc.getUTCDay();
  }

  // 对于其他 Date 对象，我们需要小心 "Local Time" 陷阱。
  // Use existing helper to extract NY parts, then reconstruct UTC date to check day.
  // This guarantees we respect NY timezone logic.
  const p = getNyParts(d);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  return utc.getUTCDay();
}

// 返回形如 "(周三)" 的中文短标签（纽约时区）
export function nyWeekdayLabel(input: Date | number | string): string {
  const zh = ['日', '一', '二', '三', '四', '五', '六'];
  const idx = nyWeekdayIndex(input);
  return `(周${zh[idx]})`;
}

// 2025/2026 交易日假期表（权威数据源）
// 移动自 use-holdings.ts，作为全局唯一的假期数据源
export const US_MARKET_HOLIDAY_NAMES: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Washington's Birthday",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth National Independence Day',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving Day',
  '2025-12-25': 'Christmas Day',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth National Independence Day',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
};

export const US_MARKET_HOLIDAYS = new Set<string>(Object.keys(US_MARKET_HOLIDAY_NAMES));

export function getMarketClosedReason(dateStr: string): string | null {
  if (US_MARKET_HOLIDAYS.has(dateStr)) {
    return US_MARKET_HOLIDAY_NAMES[dateStr];
  }
  const index = nyWeekdayIndex(dateStr);
  if (index === 0 || index === 6) {
    return 'Weekend';
  }
  return null;
}

// 获取上一交易日（递归查找）
export function prevNyTradingDayString(base: string): string {
  let [year, month, day] = base.split('-').map(Number);
  // 从中午12点开始倒推，避免时区边界问题
  let ts = Date.UTC(year, month - 1, day, 12, 0, 0);
  ts -= 24 * 60 * 60 * 1000;
  for (; ;) {
    const candidateDate = new Date(ts);
    const candidateStr = toNyCalendarDayString(candidateDate);
    const wd = nyWeekdayIndex(candidateDate);
    if (wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(candidateStr)) {
      return candidateStr;
    }
    ts -= 24 * 60 * 60 * 1000;
  }
}

// 判断某天是否为交易日
export function isNyTradingDay(dayStr: string): boolean {
  // 简单校验格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return false;

  // 解析日期对象以获取星期
  const [y, m, d] = dayStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const wd = nyWeekdayIndex(date);

  return wd > 0 && wd < 6 && !US_MARKET_HOLIDAYS.has(dayStr);
}

/**
 * 获取“有效交易日”（Effective Trading Day）。
 * 规则：
 * 1. 如果当前时间 < 09:30（开盘前），视为“今天还没开始”，返回上一个交易日。
 * 2. 如果当前时间 >= 09:30：
 *    - 如果今天是交易日，返回今天。
 *    - 如果今天是非交易日，返回上一个交易日。
 * 
 * @param now 可选，默认为当前时间
 */
export function getEffectiveTradingDay(now: Date = new Date()): string {
  const todayNy = toNyCalendarDayString(now);

  // 获取当前 NY 时间的小时和分钟
  const nyTimeStr = toNyHmsString(now);
  const [hh, mm] = nyTimeStr.split(':').map(Number);
  const t = hh * 3600 + mm * 60;
  const OPEN_TIME = 9 * 3600 + 30 * 60; // 09:30

  const isBeforeOpen = t < OPEN_TIME;

  console.log('[ny-time] getEffectiveTradingDay Debug:', {
    nowISO: now.toISOString(),
    nyTimeStr,
    hh, mm,
    isBeforeOpen,
    todayNy
  });

  // 如果还没到 09:30，直接回退一天作为起点（无论今天是不是交易日，只要没开盘，就看昨天）
  // 注意：如果今天是周一 08:00，回退到周日，周日非交易日，prevNyTradingDayString 会继续回退到周五。
  // 如果今天是周五 08:00，回退到周四。
  // 逻辑简化：
  // 1. 先确定“名义日期”：如果 < 09:30，名义日期 = 昨天；否则 = 今天。
  // 2. 检查“名义日期”是否为交易日。
  //    - 是：返回名义日期。
  //    - 否：返回名义日期之前的最近一个交易日。

  let nominalDay = todayNy;
  if (isBeforeOpen) {
    // 回退一天
    const [y, m, d] = todayNy.split('-').map(Number);
    const ts = Date.UTC(y, m - 1, d, 12, 0, 0) - 24 * 60 * 60 * 1000;
    nominalDay = toNyCalendarDayString(new Date(ts));
  }

  if (isNyTradingDay(nominalDay)) {
    return nominalDay;
  } else {
    return prevNyTradingDayString(nominalDay);
  }
}

/**
 * 根据基准日期（通常是 todayNy），计算 WTD, MTD, YTD 的起始日期。
 * WTD: 本周一 (如果今天是周日，则为上周一？不，通常 WTD 是指本周。如果今天是周日，本周一就是6天前)
 * MTD: 本月1号
 * YTD: 本年1月1号
 */
export function getPeriodStartDates(baseDateStr: string): { wtd: string; mtd: string; ytd: string } {
  assertYyyyMmDd(baseDateStr);
  const [y, m, d] = baseDateStr.split('-').map(Number);

  // 构造日期对象 (UTC 中午，避免时区偏移)
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  // 1. YTD: YYYY-01-01 (Year Start)
  // This is the hard cutoff for EVERYTHING.
  const ytd = `${y}-01-01`;

  // 2. MTD: YYYY-MM-01
  // If we are in Jan, MTD start is Jan 1. If we are in Feb, Feb 1.
  // This naturally respects Year boundary since MM changes.
  const mtd = `${y}-${String(m).padStart(2, '0')}-01`;

  // 3. WTD: 本周一 (Standard Logic)
  // nyWeekdayIndex: 0=Sun, 1=Mon, ..., 6=Sat
  const wd = nyWeekdayIndex(date);
  // 如果是周日(0)，回退6天到周一; Otherwise back to Mon.
  const daysToSubtract = wd === 0 ? 6 : wd - 1;
  const wtdDate = new Date(date.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
  let wtd = toNyCalendarDayString(wtdDate);

  // [FIX] Trading Year Cutoff Rule
  // "WTD/MTD/YTD 全部按新年重新起算"
  // If the standard WTD start (Monday) is in the PREVIOUS year (e.g. Dec 29),
  // but we are currently in the NEW year (e.g. Jan 2),
  // we must CLAMP the WTD start to Jan 1st of the current year.
  // We can just compare strings: if wtd < ytd, then wtd = ytd.
  if (wtd < ytd) {
    wtd = ytd;
  }

  return { wtd, mtd, ytd };
}

/**
 * 获取各周期的“基准日”（Base Date），即周期开始前的最后一个交易日。
 * 用于计算周期内的“存量差”（Unrealized Delta）。
 */
export function getPeriodBaseDates(baseDateStr: string): { wtd: string; mtd: string; ytd: string } {
  const starts = getPeriodStartDates(baseDateStr);
  return {
    wtd: prevNyTradingDayString(starts.wtd),
    mtd: prevNyTradingDayString(starts.mtd),
    ytd: prevNyTradingDayString(starts.ytd),
  };
}

// 获取某年最后一个交易日
export function getLastTradingDayOfYear(year: number): string {
  const dec31 = `${year}-12-31`;
  if (isNyTradingDay(dec31)) return dec31;
  return prevNyTradingDayString(dec31);
}
