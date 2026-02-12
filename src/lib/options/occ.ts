
/**
 * @fileoverview OCC (Options Clearing Corporation) code generation utilities.
 */

/**
 * Sanitizes the underlying ticker symbol for OCC compliance.
 * Removes whitespace, converts to uppercase, filters non-alphanumeric characters (allowing dots),
 * and truncates to 6 characters.
 * @param ticker The raw ticker symbol, e.g., "BRK.B ".
 * @returns A sanitized ticker suitable for OCC, e.g., "BRK.B".
 */
export function sanitizeUnderlying(ticker: string): string {
  if (!ticker || typeof ticker !== 'string') return '';
  return ticker
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, '')
    .slice(0, 6);
}

/**
 * Formats a Date object into a YYMMDD string.
 * @param expiry The expiration date.
 * @returns A string in YYMMDD format, e.g., "250117".
 */
export function formatExpiryYYMMDD(expiry: Date): string {
  if (!(expiry instanceof Date) || isNaN(expiry.getTime())) {
    throw new Error('Invalid expiry date provided.');
  }
  const year = expiry.getFullYear().toString().slice(-2);
  const month = (expiry.getMonth() + 1).toString().padStart(2, '0');
  const day = expiry.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Formats a strike price into an 8-digit string required by OCC.
 * The value is multiplied by 1000, rounded, and zero-padded to the left.
 * @param strike The strike price, e.g., 175 or 175.5.
 * @returns An 8-digit string, e.g., "00175000" or "00175500".
 * @throws If the strike is not a finite positive number.
 */
export function formatStrike8(strike: number): string {
  if (typeof strike !== 'number' || !isFinite(strike) || strike < 0) {
    throw new Error('Strike price must be a non-negative number.');
  }
  const scaled = Math.round(strike * 1000);
  return scaled.toString().padStart(8, '0');
}

/**
 * Builds a full OCC21-compliant option symbol.
 * @param params The option components.
 * @example
 * buildOCC({
 *   underlying: 'AAPL',
 *   expiry: new Date('2025-01-17T12:00:00Z'),
 *   cp: 'C',
 *   strike: 200
 * });
 * // Returns "AAPL  250117C00200000"
 */
export function buildOCC(params: {
  underlying: string;
  expiry: Date;
  cp: 'C' | 'P';
  strike: number;
}): string {
  const underlyingClean = sanitizeUnderlying(params.underlying);
  const expiryStr = formatExpiryYYMMDD(params.expiry);
  const strikeStr = formatStrike8(params.strike);

  // Return compact format (e.g. AAPL250117C00200000)
  return `${underlyingClean}${expiryStr}${params.cp}${strikeStr}`;
}
