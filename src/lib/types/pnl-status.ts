/**
 * Single source of truth for PnL and EOD statuses.
 * Standardizes on snake_case as per LuckyTrading777 standard.
 */
export type EodStatus =
    | 'ok'
    | 'error'
    | 'missing'
    | 'pending'
    | 'stale'
    | 'plan_limited'
    | 'no_liquidity'
    | 'fetch_incomplete';

export type DailyPnlStatus =
    | 'ok'
    | 'partial'
    | 'missing_data'
    | 'market_closed'
    | 'plan_limited'
    | 'no_liquidity'
    | 'not_open'
    | 'intraday'
    | 'fetch_incomplete'
    | 'loading_eod';
