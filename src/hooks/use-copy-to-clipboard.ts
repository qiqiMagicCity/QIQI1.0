// src/hooks/use-copy-to-clipboard.ts
import { useCallback, useRef, useState } from "react";

/** 降级：隐藏 textarea + execCommand('copy') */
function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export interface UseCopyToClipboardResult {
  /** 触发复制，返回是否成功 */
  copy: (text: string) => Promise<boolean>;
  /** 正在复制中 */
  isCopying: boolean;
  /** 成功后短暂为 true（约 1.2s），可用于“已复制”提示 */
  copied: boolean;
  /** 若失败，给出错误代号（不抛异常）；成功则为 null */
  error: string | null;
}

/**
 * 统一的“安全复制”Hook：
 * - 优先使用 Clipboard API；
 * - 不可用或失败时自动降级到 execCommand；
 * - 兼容 SSR（先判断 window/document 是否存在）；
 * - 不依赖 UI（不 toast），仅返回状态。
 */
export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    setIsCopying(true);
    setError(null);

    const hasWindow = typeof window !== "undefined";
    const hasDocument = typeof document !== "undefined";
    let didCopy = false;

    try {
      // 优先：现代 API
      const clip = (typeof navigator !== "undefined" && (navigator as any).clipboard) || null;
      const canWrite = !!clip?.writeText;

      if (canWrite) {
        // 尝试确保焦点（可能被策略拒绝，忽略异常）
        if (hasDocument && !document.hasFocus()) {
          if (hasWindow) {
            try { (window as any)?.focus?.(); } catch {}
          }
        }
        try {
          await clip.writeText(text);
          didCopy = true;
        } catch {
          // 转用降级方案
        }
      }

      if (!didCopy && hasDocument) {
        didCopy = fallbackCopy(text);
      }

      if (didCopy) {
        setCopied(true);
        return true;
      } else {
        setError("COPY_FAILED");
        return false;
      }
    } finally {
      // 仅在成功时安排 copied 自动复位
      if (didCopy) {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1200);
      }
      setIsCopying(false);
    }
  }, []);

  return { copy, isCopying, copied, error };
}
