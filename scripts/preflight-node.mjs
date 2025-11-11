// scripts/preflight-node.mjs
import { existsSync } from 'node:fs';

const requiredMajor = 20;
const major = Number(process.versions.node.split('.')[0] || 0);
if (major !== requiredMajor) {
  console.error(`[Preflight] Node ${requiredMajor}.x 必须，当前是 ${process.versions.node}`);
  process.exit(1);
}

if (!existsSync('package-lock.json')) {
  console.error('[Preflight] 缺少 package-lock.json；请使用 npm v9+ 并提交锁文件。');
  process.exit(1);
}

console.log('[Preflight] Node 与锁文件校验通过。');
