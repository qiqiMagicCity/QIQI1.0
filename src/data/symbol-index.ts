/* 
 * Static Symbol Index (read-only)
 * - 不依赖后端；仅作前端检索用
 * - 不触碰任何交易数据（Rule 1.1）
 * - 仅提供检索能力；UI 集成将在 ⑤.2 执行
 */

export type SymbolEntry = {
  symbol: string;            // 证券代码（主键，必填，统一大写）
  nameEn: string;            // 英文名（必填）
  nameZh?: string;           // 中文名（可选）
  type: 'equity' | 'etf';    // 类型
  exchange?: string;         // 交易所（可选，展示用途）
  aliases?: string[];        // 别名/等价代码/简称
  tokens?: string[];         // 额外可检索关键词（小写）
};

// 注意：仅放我们项目中高频用到的安全条目。之后可以按需追加。
// 若不确定中文名，先留空 nameZh，避免误导。
export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'AMZN', nameEn: 'Amazon.com Inc.', nameZh: '亚马逊', type: 'equity' },
  { symbol: 'AMD',  nameEn: 'Advanced Micro Devices Inc.', nameZh: '超威半导体', type: 'equity' },
  { symbol: 'AAPL', nameEn: 'Apple Inc.', nameZh: '苹果', type: 'equity' },
  { symbol: 'BA',   nameEn: 'The Boeing Company', nameZh: '波音', type: 'equity' },
  { symbol: 'DIS',  nameEn: 'The Walt Disney Company', nameZh: '迪士尼', type: 'equity' },
  { symbol: 'GOOGL',nameEn: 'Alphabet Inc. Class A', nameZh: 'Alphabet A（谷歌）', type: 'equity', aliases: ['ALPHABET', 'GOOGLE', 'NASDAQ:GOOGL'] },
  { symbol: 'GOOG', nameEn: 'Alphabet Inc. Class C', nameZh: 'Alphabet C（谷歌）', type: 'equity', aliases: ['ALPHABET', 'GOOGLE', 'NASDAQ:GOOG'] },
  { symbol: 'PYPL', nameEn: 'PayPal Holdings Inc.', nameZh: '贝宝', type: 'equity' },
  { symbol: 'UAL',  nameEn: 'United Airlines Holdings Inc.', nameZh: '美联航', type: 'equity' },
  { symbol: 'INTC', nameEn: 'Intel Corporation', nameZh: '英特尔', type: 'equity' },
  { symbol: 'SCHW', nameEn: 'Charles Schwab Corp.', nameZh: '嘉信理财', type: 'equity' },
  { symbol: 'NFLX', nameEn: 'Netflix Inc.', nameZh: '奈飞', type: 'equity' },
  { symbol: 'FFIV', nameEn: 'F5 Inc.', nameZh: 'F5 网络', type: 'equity' },
  { symbol: 'CLF',  nameEn: 'Cleveland-Cliffs Inc.', nameZh: '克利夫兰-克里夫斯', type: 'equity' },
  { symbol: 'SBUX', nameEn: 'Starbucks Corporation', nameZh: '星巴克', type: 'equity' },
  { symbol: 'APP',  nameEn: 'AppLovin Corp.', nameZh: 'AppLovin', type: 'equity' },
  { symbol: 'TSLA', nameEn: 'Tesla, Inc.', nameZh: '特斯拉', type: 'equity', aliases: ['TESLA'] },

  { symbol: 'DUK',  nameEn: 'Duke Energy Corporation', nameZh: '杜克能源', type: 'equity' },
  { symbol: 'SO',   nameEn: 'The Southern Company', nameZh: '南方公司', type: 'equity' },
  { symbol: 'VST',  nameEn: 'Vistra Corp.', nameZh: 'Vistra', type: 'equity' },
  { symbol: 'NRG',  nameEn: 'NRG Energy Inc.', nameZh: 'NRG 能源', type: 'equity' },
  { symbol: 'CEG',  nameEn: 'Constellation Energy Corp.', nameZh: '星座能源', type: 'equity' },
  { symbol: 'IBKR', nameEn: 'Interactive Brokers Group', nameZh: '盈透证券', type: 'equity' },

  { symbol: 'XLU',  nameEn: 'Utilities Select Sector SPDR Fund', nameZh: '公用事业板块ETF', type: 'etf' },
  { symbol: 'KBWB', nameEn: 'Invesco KBW Bank ETF', nameZh: 'KBW 银行ETF', type: 'etf' },
  { symbol: 'USO',  nameEn: 'United States Oil Fund', nameZh: '美国原油基金', type: 'etf' },
  { symbol: 'NVDL', nameEn: 'GraniteShares 1.5x Long NVDA Daily ETF', type: 'etf' },
  { symbol: 'TSLL', nameEn: 'Direxion Daily TSLA Bull 1.5X Shares', type: 'etf', aliases: ['TSLA BULL'] },
  { symbol: 'TSLQ', nameEn: 'AXS TSLA Bear Daily ETF', type: 'etf', aliases: ['TSLA BEAR'] },
];

// 归一化（大小写/空白）
const norm = (s: string) => s.trim().toLowerCase();

// 为每个条目构建最基本 tokens（symbol/英文名/中文名/别名）
function buildTokens(e: SymbolEntry): string[] {
  const t = new Set<string>();
  t.add(norm(e.symbol));
  t.add(norm(e.nameEn));
  if (e.nameZh) t.add(norm(e.nameZh));
  (e.aliases ?? []).forEach(a => t.add(norm(a)));
  (e.tokens ?? []).forEach(a => t.add(norm(a)));
  return Array.from(t);
}

// 轻量检索：优先 startsWith，其次 includes；不引入外部依赖
export function searchSymbols(q: string, limit = 20): SymbolEntry[] {
  const query = norm(q);
  if (!query) return [];

  type Scored = { e: SymbolEntry; score: number };
  const scored: Scored[] = [];

  for (const e of SYMBOLS) {
    const tokens = buildTokens(e);
    let best = Infinity;
    for (const tk of tokens) {
      if (tk.startsWith(query)) best = Math.min(best, 0);     // 最高优先
      else if (tk.includes(query)) best = Math.min(best, 1);  // 次优先
    }
    if (best !== Infinity) scored.push({ e, score: best });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.e.symbol.localeCompare(b.e.symbol);
  });

  return scored.slice(0, limit).map(s => s.e);
}

// 自检（开发期手动调用，非运行时执行）
export function __dev_demo__() {
  // 示例：searchSymbols('go');
  // 期望：GOOG / GOOGL 优先返回
}
