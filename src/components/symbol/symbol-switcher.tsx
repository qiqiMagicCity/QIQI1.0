'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, X, Grid, ListFilter } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface SymbolSwitcherProps {
    symbols: string[];
    currentSymbol: string;
}

export function SymbolSwitcher({ symbols, currentSymbol }: SymbolSwitcherProps) {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredSymbols = useMemo(() => {
        // Extract unique root symbols
        const rootSymbols = Array.from(new Set(symbols.map(s => {
            // Simple heuristic: if it contains spaces or numbers that look like option format, try to extract root
            // Our option format often looks like "INTC 251101C..." or just "INTC"
            // Let's assume the first "word" is the root symbol.
            return s.split(' ')[0];
        }))).sort();

        if (!searchQuery) return rootSymbols;
        return rootSymbols.filter(s => s.includes(searchQuery.toUpperCase()));
    }, [symbols, searchQuery]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-emerald-400 gap-2"
                >
                    <Grid className="h-4 w-4" />
                    切换标的
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-950 border-slate-800 text-slate-200 max-w-3xl max-h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b border-slate-800">
                    <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                        <ListFilter className="h-5 w-5 text-emerald-500" />
                        选择标的 ({filteredSymbols.length})
                    </DialogTitle>
                </DialogHeader>

                <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <Input
                            placeholder="搜索代码 (e.g. TSLA)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
                        />
                    </div>
                </div>

                <ScrollArea className="flex-1 p-4">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                        {filteredSymbols.map((symbol) => (
                            <Link
                                key={symbol}
                                href={`/symbol/${symbol}`}
                                prefetch={false}
                                onClick={() => setOpen(false)}
                                className={cn(
                                    "flex flex-col items-center justify-center p-3 rounded-lg border transition-all hover:scale-105",
                                    symbol === currentSymbol
                                        ? "bg-emerald-500 text-slate-950 border-emerald-400 font-bold shadow-lg shadow-emerald-500/20"
                                        : "bg-slate-900/50 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-emerald-500/50 hover:text-emerald-400"
                                )}
                            >
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-2",
                                    symbol === currentSymbol ? "bg-slate-950 text-emerald-500" : "bg-slate-800 text-slate-400"
                                )}>
                                    {symbol.slice(0, 1)}
                                </div>
                                <span className="text-sm font-mono tracking-wide">{symbol}</span>
                            </Link>
                        ))}
                        {filteredSymbols.length === 0 && (
                            <div className="col-span-full text-center py-8 text-slate-500">
                                未找到匹配的标的
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
