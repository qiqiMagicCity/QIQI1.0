"use client";

import React from "react";
import Image from "next/image";

export default function DesignPreviewPage() {
    return (
        <div className="min-h-screen bg-black text-white p-4 md:p-8 overflow-y-auto">
            <h1 className="text-3xl font-bold mb-8 text-center">Logo Design Variants</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
                {/* Variant A: Frosted Card */}
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold text-emerald-400 text-center">Option A: Frosted Card (磨砂卡片)</h2>
                    <div className="bg-zinc-900 h-[600px] relative overflow-hidden rounded-2xl border border-zinc-800 flex flex-col p-8">
                        {/* Background Decoration */}
                        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                            <div className="absolute top-[-20%] right-[-10%] w-[300px] h-[300px] rounded-full bg-emerald-500 blur-[80px]" />
                        </div>

                        {/* Content */}
                        <div className="relative z-10 flex flex-col h-full justify-center">
                            {/* Logo Container */}
                            <div className="mb-8 inline-block p-6 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 shadow-lg self-start">
                                <Image
                                    src="/login-logo-large.png"
                                    alt="LuckyTrading777"
                                    width={300}
                                    height={100}
                                    className="w-[240px] h-auto object-contain"
                                />
                            </div>

                            <h2 className="text-3xl font-extrabold mb-4 leading-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
                                更专业的<br />交易记录与分析系统
                            </h2>
                            <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                                告别繁琐的 Excel，用数据驱动你的每一次交易决策。<br />
                                LuckyTrading777 助你复盘、分析、进化。
                            </p>
                        </div>
                    </div>
                </div>

                {/* Variant B: Ambient Glow */}
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold text-blue-400 text-center">Option B: Ambient Glow (环境光晕)</h2>
                    <div className="bg-zinc-900 h-[600px] relative overflow-hidden rounded-2xl border border-zinc-800 flex flex-col p-8">
                        {/* Background Decoration */}
                        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                            <div className="absolute bottom-[-20%] left-[-10%] w-[300px] h-[300px] rounded-full bg-blue-600 blur-[80px]" />
                        </div>

                        {/* Content */}
                        <div className="relative z-10 flex flex-col h-full justify-center">
                            {/* Logo Container */}
                            <div className="mb-8 relative group self-start">
                                <div className="absolute -inset-8 bg-white/10 blur-3xl rounded-full opacity-60"></div>
                                <Image
                                    src="/login-logo-large.png"
                                    alt="LuckyTrading777"
                                    width={300}
                                    height={100}
                                    className="w-[260px] h-auto object-contain relative z-10 drop-shadow-[0_0_15px_rgba(255,255,255,0.15)]"
                                />
                            </div>

                            <h2 className="text-3xl font-extrabold mb-4 leading-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
                                更专业的<br />交易记录与分析系统
                            </h2>
                            <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                                告别繁琐的 Excel，用数据驱动你的每一次交易决策。<br />
                                LuckyTrading777 助你复盘、分析、进化。
                            </p>
                        </div>
                    </div>
                </div>

                {/* Variant C: Brand Header */}
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold text-purple-400 text-center">Option C: Brand Header (品牌区域)</h2>
                    <div className="bg-zinc-900 h-[600px] relative overflow-hidden rounded-2xl border border-zinc-800 flex flex-col">

                        {/* Header Area */}
                        <div className="bg-zinc-950/50 border-b border-white/5 p-8 pb-6 backdrop-blur-sm">
                            <Image
                                src="/login-logo-large.png"
                                alt="LuckyTrading777"
                                width={300}
                                height={100}
                                className="w-[220px] h-auto object-contain"
                            />
                        </div>

                        <div className="p-8 pt-12 relative flex-1 flex flex-col justify-center">
                            {/* Background Decoration */}
                            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                                <div className="absolute top-[20%] right-[-10%] w-[300px] h-[300px] rounded-full bg-purple-500 blur-[80px]" />
                            </div>

                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-6">
                                    <div className="h-0.5 w-8 bg-emerald-500"></div>
                                    <span className="text-xs font-bold tracking-widest text-emerald-500 uppercase">Professional Tool</span>
                                </div>
                                <h2 className="text-3xl font-extrabold mb-4 leading-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
                                    更专业的<br />交易记录与分析系统
                                </h2>
                                <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                                    告别繁琐的 Excel，用数据驱动你的每一次交易决策。<br />
                                    LuckyTrading777 助你复盘、分析、进化。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
