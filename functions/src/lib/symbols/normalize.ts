/**
 * Symbol normalization utilities.
 */

const VALID_SYMBOL_REGEX = /^[A-Z0-9._-]+$/;

/**
 * Normalizes a single symbol.
 * - Trims whitespace.
 * - Converts to uppercase.
 * - Validates against a regex.
 *
 * @param raw The raw string to normalize.
 * @returns An object with the normalized value or a reason for invalidity.
 */
export function normalizeSymbol(raw: string): {
  value: string | null;
  reason?: string;
} {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { value: null, reason: 'Input must be a non-empty string.' };
  }

  const value = raw.trim().toUpperCase();

  if (!VALID_SYMBOL_REGEX.test(value)) {
    return {
      value: null,
      reason: `Invalid format. Must match regex: ${VALID_SYMBOL_REGEX.toString()}`,
    };
  }



  return { value };
}

/**
 * Normalizes a list of symbols.
 * - Enforces a maximum list size for a single request.
 * - Removes duplicates (case-insensitive).
 * - Categorizes symbols into valid, invalid (bad format), and skipped (duplicates).
 *
 * @param input The array of strings to normalize.
 * @param options Options for normalization, including max single list size.
 * @returns An object containing valid, invalid, and skipped symbols.
 * @throws An error if the input list exceeds the maximum allowed size.
 */
export function normalizeList(
  input: string[],
  { maxSingle = 500 }: { maxSingle?: number },
): {
  valid: string[];
  invalid: { symbol: string; reason: string }[];
  skipped: string[];
} {
  if (!Array.isArray(input)) {
    throw new Error('Input must be an array.');
  }

  if (input.length > maxSingle) {
    throw new Error(
      `Input list exceeds the maximum size of ${maxSingle} symbols per request.`,
    );
  }

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: { symbol: string; reason: string }[] = [];
  const skipped: string[] = [];

  for (const rawSymbol of input) {
    const { value, reason } = normalizeSymbol(rawSymbol);

    if (value) {
      if (seen.has(value)) {
        skipped.push(value);
      } else {
        seen.add(value);
        valid.push(value);
      }
    } else {
      invalid.push({ symbol: rawSymbol, reason: reason! });
    }
  }

  // Sort for consistent output and easier auditing
  valid.sort();

  return { valid, invalid, skipped };
}