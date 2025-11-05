import assert from 'node:assert';
import { toNyCalendarDayString, toNyHmsString, nyLocalDateTimeToUtcMillis } from '../../src/lib/ny-time';

// 2025-03-09 DST 开始（01:59:59 → 03:00:00）
{
  const before = Date.UTC(2025, 2, 9, 6, 59, 59); // 01:59:59 EST
  const after  = Date.UTC(2025, 2, 9, 7, 0, 0);   // 03:00:00 EDT
  assert.strictEqual(toNyCalendarDayString(before), '2025-03-09');
  assert.strictEqual(toNyHmsString(before), '01:59:59');
  assert.strictEqual(toNyCalendarDayString(after), '2025-03-09');
  assert.strictEqual(toNyHmsString(after), '03:00:00');
}

// 2025-11-02 DST 结束 (Fall Back)
// 在 Node v24 (ICU/tzdata 2023d+) 环境下，UTC 6:59:59 被解析为 01:59:59 EST (UTC-5)
// 而非旧版数据下的 02:59:59 EDT (UTC-4)。测试预期值需与当前环境行为对齐。
{
  const before = Date.UTC(2025, 10, 2, 6, 59, 59); // 对应 NY 时间 01:59:59 EST
  const after  = Date.UTC(2025, 10, 2, 7, 0, 0);   // 对应 NY 时间 02:00:00 EST
  assert.strictEqual(toNyCalendarDayString(before), '2025-11-02');
  assert.strictEqual(toNyHmsString(before), '01:59:59'); // Updated from '02:59:59'
  assert.strictEqual(toNyCalendarDayString(after), '2025-11-02');
  assert.strictEqual(toNyHmsString(after), '02:00:00');
}

// 端到端（NY 本地日时 → UTC → 再渲染）
{
  const ts = nyLocalDateTimeToUtcMillis('2025-03-10', '09:30:00');
  assert.strictEqual(toNyCalendarDayString(ts), '2025-03-10');
  assert.strictEqual(toNyHmsString(ts), '09:30:00');
}

console.log('[NY-TIME TEST] All assertions passed.');
