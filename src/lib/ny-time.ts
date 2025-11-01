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
