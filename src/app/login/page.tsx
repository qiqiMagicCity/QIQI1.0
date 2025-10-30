"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
} from "firebase/auth";

/**
 * 登录/注册页：提供邮箱/密码登录与注册，以及 Google 登录。
 * 说明：
 * - 使用 browserLocalPersistence 确保会话持久化。
 * - 用户可以在登录和注册模式间切换。
 * - 已登录用户访问本页将自动重定向到首页（/）。
 */
export default function LoginPage() {
  const router = useRouter();
  const auth = getAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
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

  async function handleEmailPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await ensurePersistence();
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      router.replace("/");
    } catch (err: any) {
      // 常见错误：auth/invalid-credential, auth/email-already-in-use, etc.
      if (err.code === 'auth/email-already-in-use') {
        setError("该邮箱已被注册，请直接登录或使用其他邮箱。");
      } else if (err.code === 'auth/weak-password') {
        setError("密码太弱，请使用至少6位字符。");
      } else if (err.code === 'auth/invalid-credential') {
        setError("登录失败，请检查账户与密码。");
      }
       else {
        setError(err?.code || err?.message || "操作失败，请稍后再试。");
      }
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

  const toggleMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError(null);
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] rounded-2xl shadow-lg p-6 md:p-8 bg-white dark:bg-neutral-900">
        <h1 className="text-2xl font-semibold mb-2">{mode === 'login' ? '登录' : '注册新账户'}</h1>
        <p className="text-sm text-neutral-500 mb-6">
          使用邮箱密码或 Google 登录继续使用本应用。
        </p>

        <form onSubmit={handleEmailPasswordSubmit} className="space-y-4">
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
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
            {busy ? "正在处理..." : (mode === 'login' ? "邮箱密码登录" : "创建账户")}
          </button>
        </form>

        <div className="mt-4 text-center">
            <button onClick={toggleMode} className="text-sm text-primary hover:underline">
                {mode === 'login' ? '还没有账户？立即注册' : '已有账户？直接登录'}
            </button>
        </div>

        <div className="my-4 text-center text-sm text-neutral-500 relative">
            <span className="bg-white dark:bg-neutral-900 px-2 z-10 relative">或</span>
            <div className="absolute left-0 top-1/2 w-full h-px bg-border -z-0"></div>
        </div>

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
