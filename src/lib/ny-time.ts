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
  const d = (input instanceof Date) ? input : new Date(input);
  // 使用带时区的 Intl 计算星期，避免本地时区偏差
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(d); // e.g. 'Sun' | 'Mon' ...
  const map: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return map[s] ?? 0;
}

// 返回形如 "(周三)" 的中文短标签（纽约时区）
export function nyWeekdayLabel(input: Date | number | string): string {
  const zh = ['日','一','二','三','四','五','六'];
  const idx = nyWeekdayIndex(input);
  return `(周${zh[idx]})`;
}
