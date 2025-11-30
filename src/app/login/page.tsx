"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, TrendingUp, PieChart, BarChart3 } from "lucide-react";
import { useAuth, useUser } from "@/firebase";

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const { user, isUserLoading } = useUser();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !isUserLoading) {
      router.replace("/");
    }
  }, [user, isUserLoading, router]);

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
      if (err.code === 'auth/email-already-in-use') {
        setError("该邮箱已被注册，请直接登录或使用其他邮箱。");
      } else if (err.code === 'auth/weak-password') {
        setError("密码太弱，请使用至少6位字符。");
      } else if (err.code === 'auth/invalid-credential') {
        setError("登录失败，请检查账户与密码。");
      } else {
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
      // 这里的错误提示已移除开发者相关信息
      setError("Google 登录失败，请稍后重试。");
      console.error("Google Sign-In Error:", err);
    } finally {
      setBusy(false);
    }
  }

  const toggleMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError(null);
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-background text-foreground">
      {/* Left Side (Desktop) / Top (Mobile) - Branding */}
      <div className="w-full md:w-1/2 lg:w-[55%] relative overflow-hidden flex flex-col justify-center p-8 md:p-12 bg-zinc-950">

        {/* Dynamic Background Layers */}
        <div className="absolute inset-0 w-full h-full">
          {/* Base Gradient */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,_#2e1065_0%,_transparent_50%)] opacity-40" /> {/* Purple top-left */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,_#0891b2_0%,_transparent_50%)] opacity-40" /> {/* Cyan bottom-right */}

          {/* Circuit/Tech Pattern Overlay (CSS Grid) */}
          <div className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
              backgroundSize: '40px 40px'
            }}
          />

          {/* Glowing Orbs */}
          <div className="absolute top-1/4 right-1/4 w-64 h-64 bg-purple-500/20 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-cyan-500/20 rounded-full blur-[100px]" />
        </div>

        <div className="relative z-10 max-w-lg mx-auto md:mx-0">
          {/* Logo Container - Frosted Glass to handle white background */}
          <div className="mb-10 inline-block">
            <div className="relative group">
              {/* Glow effect behind logo */}
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>

              <div className="relative p-6 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl">
                <Image
                  src="/login-logo-large.png"
                  alt="LuckyTrading777"
                  width={500}
                  height={150}
                  className="w-[260px] md:w-[320px] h-auto object-contain"
                  priority
                />
              </div>
            </div>
          </div>

          <h2 className="text-4xl md:text-5xl font-extrabold mb-6 leading-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 animate-gradient-x">
            更专业的<br />交易记录与分析系统
          </h2>

          <p className="text-lg text-zinc-400 mb-10 leading-relaxed">
            告别繁琐的 Excel，用数据驱动你的每一次交易决策。
            LuckyTrading777 助你复盘、分析、进化。
          </p>

          <div className="space-y-5">
            <div className="flex items-center gap-4 group">
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors border border-emerald-500/10">
                <TrendingUp className="w-5 h-5" />
              </div>
              <span className="text-zinc-300 font-medium group-hover:text-white transition-colors">自动统计盈亏，实时掌握账户动态</span>
            </div>
            <div className="flex items-center gap-4 group">
              <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20 transition-colors border border-cyan-500/10">
                <PieChart className="w-5 h-5" />
              </div>
              <span className="text-zinc-300 font-medium group-hover:text-white transition-colors">多维持仓分布，优化资产配置</span>
            </div>
            <div className="flex items-center gap-4 group">
              <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20 transition-colors border border-purple-500/10">
                <BarChart3 className="w-5 h-5" />
              </div>
              <span className="text-zinc-300 font-medium group-hover:text-white transition-colors">深度交易效率分析，提升胜率</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side (Desktop) / Bottom (Mobile) - Login Form */}
      <div className="w-full md:w-1/2 lg:w-[45%] flex items-center justify-center p-4 md:p-8 bg-background">
        <Card className="w-full max-w-md border-none shadow-none md:border md:shadow-xl bg-transparent md:bg-card">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {mode === 'login' ? '欢迎回来' : '创建账户'}
            </CardTitle>
            <CardDescription>
              {mode === 'login'
                ? '输入邮箱密码或使用 Google 登录'
                : '注册以开始您的专业交易之旅'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleEmailPasswordSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="email">
                  邮箱
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="password">
                  密码
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "请稍候..." : (mode === 'login' ? "登录" : "注册")}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background md:bg-card px-2 text-muted-foreground">
                  或者
                </span>
              </div>
            </div>

            <Button variant="outline" type="button" disabled={busy} className="w-full" onClick={handleGoogleSignIn}>
              <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
              </svg>
              使用 Google 登录
            </Button>

            <div className="text-center text-sm">
              <span className="text-muted-foreground">
                {mode === 'login' ? "还没有账户？" : "已有账户？"}
              </span>{" "}
              <button
                type="button"
                onClick={toggleMode}
                className="underline underline-offset-4 hover:text-primary font-medium"
              >
                {mode === 'login' ? "立即注册" : "直接登录"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
