// scripts/ny-time-guard.mjs
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

const FILE_RE = /\.(ts|tsx)$/i;
const BAN_PATTERNS = [
  { name: 'date-fns format with P tokens', re: /format\s*\([^,]+,\s*"(?:P|PP|PPP|PPPP)"/g },
  { name: 'toLocaleDateString/TimeString', re: /\.toLocale(?:Date|Time)String\s*\(/g },
  { name: 'Intl.DateTimeFormat', re: /Intl\.DateTimeFormat\s*\(/g },
  { name: 'Redundant (NY) label', re: /\((?:NY|纽约)\)|（?:NY|纽约）/g },
  { name: 'Date-only string ctor', re: /new\s+Date\s*\(\s*['"]\d{4}-\d{2}-\d{2}['"]\s*\)/g },
  { name: 'Date.parse(YYYY-MM-DD)', re: /Date\.parse\s*\(\s*['"]\d{4}-d{2}-\d{2}['"]\s*\)/g },
];

const violations = [];

function scanFile(filePath) {
  const isNyLib = filePath.replaceAll('\\','/').includes('/src/lib/ny-time');
  const patterns = isNyLib
    ? BAN_PATTERNS.filter(p => !['Intl.DateTimeFormat','toLocaleDateString/TimeString'].includes(p.name))
    : BAN_PATTERNS;

  const text = fs.readFileSync(filePath, 'utf8');
  patterns.forEach(({ name, re }) => {
    let m;
    while ((m = re.exec(text)) !== null) {
      const idx = m.index;
      const before = text.slice(0, idx);
      const line = before.split('\n').length;
      const snippet = text.split('\n')[line - 1]?.trim() ?? '';
      violations.push({ file: filePath, line, rule: name, snippet });
      // 防止死循环
      if (re.lastIndex === idx) re.lastIndex++;
    }
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/(^|\/)(\.next|dist|build|coverage|node_modules|\.git)\//.test(p.replaceAll('\\','/') + '/')) continue;
      walk(p);
    } else if (FILE_RE.test(entry.name)) {
      scanFile(p);
    }
  }
}

if (!fs.existsSync(SRC_DIR)) {
  console.error('[NY-GUARD] src/ 目录不存在，跳过扫描。');
  process.exit(0);
}

walk(SRC_DIR);

if (violations.length) {
  console.error('\n[NY-GUARD] 发现不符合 2.5 的 UI 文案/格式化用法：');
  for (const v of violations) {
    console.error(`- ${v.rule}: ${v.file}:${v.line}\n    ${v.snippet}`);
  }
  console.error('\n请改为使用 "@/lib/ny-time" 提供的 API（toNyCalendarDayString / toNyHmsString / nyWeekdayLabel）。');
  process.exit(1);
} else {
  console.log('[NY-GUARD] 通过。未发现违例。');
}
