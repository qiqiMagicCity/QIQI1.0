'use client';

import { SymbolSwitcher } from '@/components/symbol/symbol-switcher';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface SymbolNavBarProps {
    symbols: string[];
    currentSymbol: string;
}

export function SymbolNavBar({ symbols, currentSymbol }: SymbolNavBarProps) {
    return (
        <div className="w-full border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm sticky top-0 z-50">
            <div className="flex items-center gap-2 p-2">
                {/* Switcher Button */}
                <div className="shrink-0 pl-2">
                    <SymbolSwitcher symbols={symbols} currentSymbol={currentSymbol} />
                </div>

                {/* Divider */}
                <div className="h-6 w-px bg-slate-800 mx-2 shrink-0" />

                {/* Scrollable List (Quick Access) */}
                <ScrollArea className="flex-1 whitespace-nowrap">
                    <div className="flex w-max space-x-2 p-2">
                        {symbols.map((symbol) => (
                            <Link
                                key={symbol}
                                href={`/symbol/${symbol}`}
                                prefetch={false}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold transition-all border",
                                    symbol === currentSymbol
                                        ? "bg-emerald-500 text-slate-950 border-emerald-500 shadow-md shadow-emerald-500/10"
                                        : "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-emerald-400 hover:border-slate-700"
                                )}
                            >
                                <div className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    symbol === currentSymbol ? "bg-slate-950" : "bg-emerald-500/50"
                                )} />
                                {symbol}
                            </Link>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" className="bg-slate-800 h-2" />
                </ScrollArea>
            </div>
        </div>
    );
}
