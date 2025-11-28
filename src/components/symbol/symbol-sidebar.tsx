'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { CompanyLogo } from '@/components/common/company-logo';
import { Button } from '@/components/ui/button';

interface SidebarItem {
    symbol: string;
    hasLoss: boolean;
    hasProfit?: boolean;
    count?: number;
}

interface SymbolSidebarProps {
    items: SidebarItem[];
    currentSymbol: string;
}

export function SymbolSidebar({ items, currentSymbol }: SymbolSidebarProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredItems = useMemo(() => {
        if (!searchQuery) return items;
        return items.filter(item => item.symbol.includes(searchQuery.toUpperCase()));
    }, [items, searchQuery]);

    return (
        <div className="flex flex-col h-full bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
            {/* Header / Back to Home */}
            <div className="p-4 border-b border-slate-800 space-y-4 bg-slate-950/50">
                <Link href="/" prefetch={false}>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-slate-400 hover:text-emerald-400 hover:bg-slate-900 gap-2"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <LayoutDashboard className="h-4 w-4" />
                        <span className="font-bold">返回首页</span>
                    </Button>
                </Link>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                        placeholder="搜索标的..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
                    />
                </div>
            </div>

            {/* Symbol Grid */}
            <ScrollArea className="flex-1 p-4">
                <div className="grid grid-cols-3 gap-3">
                    {filteredItems.map((item) => {
                        const isSelected = item.symbol === currentSymbol;
                        // Determine border color based on PnL status, falling back to selection or default
                        let borderColorClass = "border-slate-800 hover:border-slate-700";
                        if (item.hasLoss) {
                            borderColorClass = "border-red-500/80 hover:border-red-500";
                        } else if (item.hasProfit) {
                            borderColorClass = "border-emerald-500/80 hover:border-emerald-500";
                        } else if (isSelected) {
                            borderColorClass = "border-emerald-500";
                        }

                        return (
                            <Link
                                key={item.symbol}
                                href={`/symbol/${item.symbol}`}
                                prefetch={false}
                                className={cn(
                                    "flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 group relative overflow-hidden",
                                    isSelected
                                        ? "bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                                        : "bg-slate-950/50 hover:bg-slate-800",
                                    borderColorClass
                                )}
                            >
                                <CompanyLogo symbol={item.symbol.split(' ')[0]} size={32} className="w-8 h-8 mb-2" />

                                <span className={cn(
                                    "font-bold text-sm tracking-wide transition-colors text-center break-words w-full",
                                    isSelected ? "text-emerald-400" : "text-slate-400 group-hover:text-emerald-400"
                                )}>
                                    {item.symbol}
                                </span>
                            </Link>
                        );
                    })}

                    {filteredItems.length === 0 && (
                        <div className="col-span-full text-center py-8 text-slate-500 text-sm">
                            未找到标的
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
