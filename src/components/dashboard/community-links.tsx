"use client";

import { Twitter, Send, Users, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function CommunityLinks() {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className="relative group cursor-pointer mr-2">
                    {/* Animated Glow Backdrop */}
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded-full opacity-0 group-hover:opacity-30 blur transition duration-500"></div>

                    {/* Main Pill Button */}
                    <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 transition-all active:scale-95 shadow-sm">

                        {/* Text (Left Side as requested) */}
                        <span className="text-xs font-medium bg-gradient-to-r from-pink-600 to-violet-600 bg-clip-text text-transparent select-none">
                            加入讨论组
                        </span>

                        {/* Divider */}
                        <div className="h-3 w-[1px] bg-slate-200 dark:bg-slate-800"></div>

                        {/* Icon with subtle shake effect on group hover */}
                        <Users className="h-3.5 w-3.5 text-slate-500 group-hover:text-violet-500 transition-colors group-hover:animate-[dance_1s_ease-in-out_infinite]" />

                        {/* Notify Dot (Optional Decoration) */}
                        <span className="absolute top-0 right-0 p-[2px]">
                            <span className="flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500"></span>
                            </span>
                        </span>
                    </div>
                </div>
            </PopoverTrigger>

            <PopoverContent className="w-72 p-0 overflow-hidden shadow-xl" align="end" sideOffset={8}>
                {/* Header Section with Gradient */}
                <div className="relative p-5 bg-gradient-to-br from-violet-600 to-indigo-700 text-white overflow-hidden">
                    <div className="absolute top-0 right-0 -mt-4 -mr-4 p-8 bg-white/10 rounded-full blur-2xl"></div>
                    <div className="relative z-10">
                        <h4 className="font-bold text-lg flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-yellow-300" />
                            LuckyTrading777 社区讨论组
                        </h4>
                        <p className="text-xs text-indigo-100 mt-1 leading-relaxed opacity-90">
                            关注我们，获取最新动态与技术支持。<br />
                            这里是您与开发者最好的沟通桥梁。
                        </p>
                    </div>
                </div>

                {/* Grid Links */}
                <div className="p-3 grid gap-1 bg-slate-50/50 dark:bg-slate-950/50">
                    <SocialLink
                        icon={<Twitter className="w-4 h-4" />}
                        label="Twitter / X"
                        subLabel="获取即时快讯"
                        href="https://x.com/LuckyTrading777"
                        color="text-sky-500 bg-sky-50 dark:bg-sky-950/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 border-sky-100 dark:border-sky-900"
                    />
                    <SocialLink
                        icon={<Send className="w-4 h-4 -rotate-45 translate-x-0.5" />}
                        label="Telegram Group"
                        subLabel="加入 2000+ 人的讨论组"
                        href="https://t.me"
                        color="text-blue-500 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border-blue-100 dark:border-blue-900"
                    />
                    <SocialLink
                        icon={<MessageCircle className="w-4 h-4" />}
                        label="WhatsApp"
                        subLabel="官方客服直连"
                        href="https://chat.whatsapp.com/IGxGNIGLkEaE5aYSLtopzA?mode=gi_t"
                        color="text-green-500 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-900/50 border-green-100 dark:border-green-900"
                    />
                </div>
            </PopoverContent>
        </Popover>
    );
}

function SocialLink({ icon, label, subLabel, href, color }: { icon: React.ReactNode, label: string, subLabel: string, href: string, color?: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
                "flex items-start gap-4 w-full p-3 rounded-xl transition-all border group relative overflow-hidden",
                "hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0",
                "bg-white dark:bg-slate-900",
                color ? "border-transparent" : "border-slate-100 dark:border-slate-800"
            )}
        >
            {/* Icon Box */}
            <div className={cn(
                "shrink-0 h-10 w-10 rounded-full flex items-center justify-center transition-transform group-hover:scale-110",
                color
            )}>
                {icon}
            </div>

            {/* Text Content */}
            <div className="flex flex-col flex-1 min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    {label}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {subLabel}
                </span>
            </div>

            {/* Hover Arrow */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                <Send className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
        </a>
    );
}
