"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
} from "firebase/auth";

/**
 * 登录页：提供邮箱/密码登录与 Google 登录。
 * 说明：
 * - 使用 browserLocalPersistence 确保会话持久化（浏览器长期保存）。
 * - 若后台未启用 Google 登录，会返回 auth/operation-not-allowed，界面会提示开启。
 * - 已登录用户访问本页将自动重定向到首页（/）。
 */
export default function LoginPage() {
  const router = useRouter();
  const auth = getAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 已登录用户直接跳转首页，避免重复登录
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.replace("/");
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensurePersistence() {
    await setPersistence(auth, browserLocalPersistence);
  }

  async function handleEmailPasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await ensurePersistence();
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/");
    } catch (err: any) {
      // 常见错误：auth/invalid-credential, auth/user-not-found, auth/wrong-password
      setError(err?.code || err?.message || "登录失败，请检查账户与密码。");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await ensurePersistence();
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.replace("/");
    } catch (err: any) {
      // 常见错误：auth/popup-blocked, auth/popup-closed-by-user, auth/operation-not-allowed
      if (err?.code === "auth/operation-not-allowed") {
        setError("Google 登录未在 Firebase 控制台启用，请在“Authentication → 登录方式”中开启 Google。");
      } else {
        setError(err?.code || err?.message || "Google 登录失败。");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] rounded-2xl shadow-lg p-6 md:p-8 bg-white dark:bg-neutral-900">
        <h1 className="text-2xl font-semibold mb-2">登录</h1>
        <p className="text-sm text-neutral-500 mb-6">
          使用邮箱密码或 Google 登录继续使用本应用。
        </p>

        <form onSubmit={handleEmailPasswordSignIn} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium">密码</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 rounded-lg bg-red-50 dark:bg-red-900/30 p-2">
              {String(error)}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl px-4 py-2 font-medium shadow-sm disabled:opacity-60
                       bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
          >
            {busy ? "正在登录..." : "邮箱密码登录"}
          </button>
        </form>

        <div className="my-4 text-center text-sm text-neutral-500">或</div>

        <button
          onClick={handleGoogleSignIn}
          disabled={busy}
          className="w-full rounded-xl px-4 py-2 font-medium border shadow-sm disabled:opacity-60
                     bg-white dark:bg-neutral-800"
          aria-label="使用 Google 登录"
        >
          使用 Google 登录
        </button>

        <p className="mt-6 text-xs text-neutral-500">
          提示：若 Google 登录报“operation-not-allowed”，请在 Firebase 控制台 → Authentication → 登录方式，启用 Google。
        </p>
      </div>
    </div>
  );
}
