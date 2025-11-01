'use client';
import { useMemo } from 'react';
import symbolMap from '@/data/symbol_cn.json';

// 将 JSON 数据转换为更易于查找的 Map
const symbols = new Map<string, string>(Object.entries(symbolMap));

export function SymbolName({ symbol }: { symbol: string }) {
  const name = useMemo(() => {
    return symbols.get(symbol) || symbol;
  }, [symbol]);

  return <>{name}</>;
}
