"use client";

import React, { PropsWithChildren, useEffect, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser } from "@/firebase/provider";

/**
 * Hook: 确保用户已登录；否则在加载完成后重定向到指定登录页
 * @param redirectTo 未登录时跳转的路由，默认 "/login"
 * @returns { ready, user }
 */
export function useRequireAuth(redirectTo: string = "/login") {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();

  const ready = useMemo(() => !!user && !isUserLoading, [user, isUserLoading]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      // 将当前路径作为回跳参数（可选）
      const url = redirectTo + (pathname ? `?next=${encodeURIComponent(pathname)}` : "");
      router.replace(url);
    }
  }, [user, isUserLoading, router, redirectTo, pathname]);

  return { ready, user };
}

/**
 * Hook: 需要管理员；未登录跳转 login；已登录但非管理员，跳转首页或指定页
 * @param redirectToIfUnauthed 未登录跳转，默认 "/login"
 * @param redirectToIfNotAdmin 已登录但不是管理员时跳转，默认 "/"
 * @returns { ready, user, isAdmin }
 */
export function useRequireAdmin(
  redirectToIfUnauthed: string = "/login",
  redirectToIfNotAdmin: string = "/"
) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAdmin, isUserLoading } = useUser();

  const ready = useMemo(() => !!user && isAdmin && !isUserLoading, [user, isAdmin, isUserLoading]);

  useEffect(() => {
    if (isUserLoading) return;

    if (!user) {
      const url = redirectToIfUnauthed + (pathname ? `?next=${encodeURIComponent(pathname)}` : "");
      router.replace(url);
      return;
    }
    if (!isAdmin) {
      router.replace(redirectToIfNotAdmin);
    }
  }, [user, isAdmin, isUserLoading, router, redirectToIfUnauthed, redirectToIfNotAdmin, pathname]);

  return { ready, user, isAdmin };
}

/** 组件包装：需要登录 */
export function RequireAuth({ children }: PropsWithChildren) {
  const { ready } = useRequireAuth();
  if (!ready) return <GuardSkeleton label="正在验证登录…" />;
  return <>{children}</>;
}

/** 组件包装：需要管理员 */
export function RequireAdmin({ children }: PropsWithChildren) {
  const { ready } = useRequireAdmin();
  if (!ready) return <GuardSkeleton label="正在验证管理员权限…" />;
  return <>{children}</>;
}

/** 极简占位：可替换为你的全局 Loading 组件 */
function GuardSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-neutral-500">
      {label}
    </div>
  );
}

/**
 * 用法示例（仅注释，不会执行）：
 *
 * // 方式一：在页面组件内部使用 Hook
 * "use client";
 * import { useRequireAdmin } from "@/components/auth/guards";
 * export default function AdminPage() {
 *   const { ready } = useRequireAdmin(); // 未登录→/login；非管理员→/
 *   if (!ready) return null;
 *   return <div>Admin Only Content</div>;
 * }
 *
 * // 方式二：用包装组件
 * "use client";
 * import { RequireAuth } from "@/components/auth/guards";
 * export default function ProtectedPage() {
 *   return (
 *     <RequireAuth>
 *       <div>Only for authenticated users</div>
 *     </RequireAuth>
 *   );
 * }
 */
