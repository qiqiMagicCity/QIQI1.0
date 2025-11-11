/**
 * 供应商（provider，数据源）覆盖窗口（coverage window）配置。
 * 这些数值基于免费档的保守估计，未来可通过配置覆盖。
 * 请勿在其他文件硬编码这些值。
 */
export const getProviderCoverageDays = (): Record<string, number> => ({
  marketstack: 365,          // 约 1 年历史（保守）
  stockdata: 30,             // 30~60 天之间取保守值 30
  fmp: 2000,                 // 足够深的历史；具体套餐差异在上层开关控制
  tiingo: 4000,              // 预留（即便当前未启用）
  polygon: 730,              // 约 2 年
  alphavantage: 365 * 20,    // 很长的历史
});

/**
 * 以“严格 UTC（世界协调时，UTC）零点”解析 YYYY-MM-DD，并返回时间戳（毫秒）。
 * 蓝图 2.1 合规：禁止使用 new Date('YYYY-MM-DD') 的环境敏感解析。
 */
const parseYmdUtc = (ymd: string): number => {
  const parts = ymd.split("-");
  if (parts.length !== 3) return NaN;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return NaN;
  return Date.UTC(y, m - 1, d);
};

/**
 * 计算两个 YYYY-MM-DD 之间的“自然日差”（calendar day difference，日历日差）
 * 实现采用严格 UTC 解析，避免运行环境时区差异带来的偏差。
 */
const dateDiffInDays = (ymd1: string, ymd2: string): number => {
  const t1 = parseYmdUtc(ymd1);
  const t2 = parseYmdUtc(ymd2);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return NaN;
  const diffMs = t2 - t1;
  return Math.round(diffMs / 86_400_000); // 1000 * 60 * 60 * 24
};

/**
 * 判断指定 provider（数据供应商，provider）是否“覆盖”目标日期。
 * @param provider 供应商名称（需与 provider.name 一致）
 * @param targetYmd 目标日期 YYYY-MM-DD（纽约口径已在调用侧处理）
 * @param nowNyYmd 纽约“今天” YYYY-MM-DD（用于计算回溯天数）
 */
export const coversDate = (
  provider: string,
  targetYmd: string,
  nowNyYmd: string,
): boolean => {
  const coverageDays = getProviderCoverageDays()[provider];
  if (coverageDays === undefined) {
    // 未登记在覆盖表中的供应商，一律视为不覆盖
    return false;
  }

  const daysAgo = dateDiffInDays(targetYmd, nowNyYmd);
  if (Number.isNaN(daysAgo)) {
    return false;
  }
  if (daysAgo < 0) {
    // 未来日期不覆盖（未来日的参数合法性由上层校验）
    return false;
  }

  return daysAgo <= coverageDays;
};
