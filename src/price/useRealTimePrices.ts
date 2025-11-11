'use client';

import { useEffect, useId, useMemo } from 'react';
import { usePriceCenterContext } from './RealTimePricesProvider';
import type { PriceRecord } from './RealTimePricesProvider';

/** 让调用方声明“我这块会用到哪些 symbols”，由 Provider 合并订阅统一分发 */
export function useRealTimePrices(symbols: string[]) {
  const id = useId();
  const center = usePriceCenterContext();

  useEffect(() => {
    center.register(id, symbols);
    return () => { center.unregister(id); };
  }, [center, id, symbols.join(',')]);

  const get = (symbol: string): PriceRecord | undefined => center.get(symbol);

  /** 提供一个只读的快照（注意：不触发渲染，主要用于调试/批量） */
  const snapshot = useMemo(() => center.map, [center]);

  return { get, snapshot };
}
