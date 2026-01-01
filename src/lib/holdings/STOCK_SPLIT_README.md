# 股票拆分处理标准流程 (Stock Split Standard Procedure)

## 核心原则 (Core Principle)

当发生股票拆分时，数据提供商（如 FMP, Yahoo）通常会修改**整个历史价格数据**（EOD Data），将其调整为**最新拆分后的口径**（Adjusted Close）。

然而，我们的**历史交易记录**和**持仓快照**仍然是基于当时的**原始股数**（Original Shares）。

### ❌ 错误示范 (Before)
- 2025-11-14: 持有 100 股 NFLX (原始), 成本 $600/股。
- EOD 价格接口返回: $60 (因为 11-17 拆分了，历史价格被除以了 10)。
- PnL 计算 = ($60 - $600) * 100 = **-$54,000 (虚假巨亏)**

### ✅ 正确逻辑 (Fixed Template)
- 必须将 EOD 价格**还原**为当时的原始价格。
- 还原公式：`P_hist = P_adj * SplitRatio`
- PnL 计算 = ($60 * 10 - $600) * 100 = $0 (正常)

---

## 1. 如何添加新拆分 (Add New Split)

请在 `src/lib/holdings/stock-splits.ts` 的 `STOCK_SPLITS` 数组中添加一条记录。

### 模板 (Data Template)

```typescript
{ 
    symbol: '股票代码', 
    effectiveDate: 'YYYY-MM-DD', // 拆分生效日（即市场价格变低的第一天）
    splitRatio: 新股数除以旧股数 // 例如 1拆10 则是 10
},
```

### 示例 (Example)

```typescript
export const STOCK_SPLITS: SplitEvent[] = [
    // ... 其他拆分 ...
    
    // [ADD NEW SPLIT HERE]
    // 例如：XYZ 公司宣布 2026-01-01 进行 1拆5
    { symbol: 'XYZ', effectiveDate: '2026-01-01', splitRatio: 5 },
];
```

---

## 2. 如何使用价格数据 (Usage in Code)

**严禁**直接使用 `eod.close` 进行历史 PnL 计算。
**必须**使用 `getRestoredHistoricalPrice` 包装函数。

### 代码模板 (Code Template)

```typescript
import { getRestoredHistoricalPrice } from '@/lib/holdings/stock-splits';

// ... 获取到 EOD 数据后 ...
if (eod?.status === 'ok') {
    // ❌ WRONG: const price = eod.close; 
    
    // ✅ CORRECT:
    const price = getRestoredHistoricalPrice(eod.close, symbol, dateString);
    
    // 使用 price 进行盈亏计算...
}
```

## 3. 为什么不修改持仓数据？

我们不修改历史持仓快照的原因是为了保证**审计一致性**。
- 历史上的某一天，账户里确实只有 100 股。
- 那个时候的股价确实是 $600。
- 如果我们强行把历史持仓改为 1000 股 @ $60，虽然 PnL 对了，但会歪曲历史事实（当时并没有 1000 股）。
- 因此，**还原价格**是唯一符合“如实记录”原则的方案。
