/**
 * These values are conservative estimates for the free tier of each provider.
 * They can be overridden by configuration in the future.
 * Do not hardcode these values in other files.
 */
export const getProviderCoverageDays = (): Record<string, number> => ({
  marketstack: 365,
  stockdata: 30, // Conservative value between 30-60
  fmp: 2000, // Conservatively deep enough (specific plan differences are handled by top-level switches)
  tiingo: 4000, // Kept for reference even if not currently enabled
  polygon: 730,
  alphavantage: 365 * 20, // very long history
});

const dateDiffInDays = (ymd1: string, ymd2: string): number => {
  const date1 = new Date(ymd1);
  const date2 = new Date(ymd2);
  const diffTime = date2.getTime() - date1.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Checks if a provider covers a given date.
 * @param provider The provider to check.
 * @param targetYmd The target date in YYYY-MM-DD format.
 * @param nowNyYmd The current date in New York in YYYY-MM-DD format.
 * @returns True if the provider covers the date, false otherwise.
 */
export const coversDate = (
  provider: string,
  targetYmd: string,
  nowNyYmd: string,
): boolean => {
  const coverageDays = getProviderCoverageDays()[provider];
  if (coverageDays === undefined) {
    return false; // Provider not in our list
  }

  const daysAgo = dateDiffInDays(targetYmd, nowNyYmd);

  if (daysAgo < 0) {
    // The date is in the future, run.ts will handle the 'invalid-argument' error.
    // For the purpose of this function, a future date is not "covered".
    return false;
  }

  return daysAgo <= coverageDays;
};
