'use client';

import { useCallback, useEffect, useId, useMemo } from 'react';
import { usePriceCenterContext } from './RealTimePricesProvider';
import type { PriceRecord } from './RealTimePricesProvider';

/**
 * useRealTimePrices（实时价格 Hook）：
 * - 调用方声明“我会用到哪些 symbols”，由 Provider 合并订阅统一分发；
 * - 通过 get(symbol) 随时读取当前最新价格；
 * - snapshot 仅用于调试/批量，不主动触发渲染。
 */
export function useRealTimePrices(symbols: string[]) {
  const id = useId();
  const center = usePriceCenterContext();

  const { register, unregister, get: getFromCenter, map } = center;

  // 注册 / 取消注册：只跟函数本身和 symbols 变化有关，不跟价格变化绑定
  // Create a stable key for symbols to prevent unnecessary re-registrations
  const symbolsKey = symbols.join(',');

  // 注册 / 取消注册：只跟函数本身和 symbols 变化有关，不跟价格变化绑定
  useEffect(() => {
    register(id, symbols);
    return () => {
      unregister(id);
    };
    // safe because unique identifier string captures all content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, unregister, id, symbolsKey]);

  // 读取某个 symbol 的当前 PriceRecord（价格记录）
  const get = useCallback((symbol: string): PriceRecord | undefined => getFromCenter(symbol), [getFromCenter]);

  /** 提供一个只读的快照（注意：不触发渲染，主要用于调试/批量查看） */
  const snapshot = useMemo(() => map, [map]);

  return { get, snapshot };
}