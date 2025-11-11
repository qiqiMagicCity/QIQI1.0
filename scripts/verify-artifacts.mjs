// scripts/verify-artifacts.mjs
import { existsSync } from 'node:fs';

if (!existsSync('.next')) {
  console.error('[Verify] 未发现 .next 产物目录。请检查构建日志。');
  process.exit(1);
}
console.log('[Verify] 构建产物存在。');
