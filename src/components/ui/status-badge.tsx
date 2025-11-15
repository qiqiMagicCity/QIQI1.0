"use client";
import { cn } from "@/lib/utils";

// 原始状态（供历史代码使用）+ 新增 UI 规范状态 ready / stale
export type Status =
  | "live"
  | "ready"
  | "stale"
  | "closed"
  | "session-pre"
  | "session-post"
  | "missing-ref-eod"
  | "missing-today-eod"
  | "pending-eod-fetch"
  | "stale-last"
  | "degraded";

// 规范化后的 UI 状态（只这 4 个会真正决定文案和颜色）
type CanonicalStatus = "live" | "ready" | "stale" | "closed";

// 统一映射：把各种细节状态折叠到 4 个 UI 状态上
function normalizeStatus(status: Status): CanonicalStatus {
  switch (status) {
    case "live":
      return "live";

    case "session-pre":
    case "ready":
      return "ready";

    case "closed":
    case "session-post":
      return "closed";

    case "stale":
    case "stale-last":
    case "missing-ref-eod":
    case "missing-today-eod":
    case "pending-eod-fetch":
    case "degraded":
    default:
      // 缺昨收 / 缺今收 / EOD 抓取中 / 数据降级 → 都视为“待更新”
      return "stale";
  }
}

export function StatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const canonical = normalizeStatus(status);

  const map: Record<CanonicalStatus, { label: string; cls: string }> = {
    live: {
      label: "盘中",
      cls: "badge-live",
    },
    ready: {
      label: "待开盘", // Ready（就绪）
      cls: "badge-info",
    },
    stale: {
      label: "待更新", // Stale（待刷新、待补数）
      cls: "badge-warning",
    },
    closed: {
      label: "已收盘",
      cls: "badge-close",
    },
  };

  const m = map[canonical];
  const isBlinking = canonical === "live";

  return (
    <div className={cn("badge", m.cls, className)}>
      <div className="relative flex h-2 w-2">
        {isBlinking && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
        )}
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
      </div>
      <span>{m.label}</span>
    </div>
  );
}