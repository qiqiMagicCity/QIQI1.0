'use client';

import { CompanyLogo } from '@/components/common/company-logo';

interface SymbolHeaderProps {
    symbol: string;
    name?: string; // Optional Chinese name or full name
}

export function SymbolHeader({ symbol, name }: SymbolHeaderProps) {
    return (
        <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-xl border border-slate-800">
            {/* Watermark Background */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none select-none opacity-[0.03]">
                <span className="text-[15rem] font-black text-white -rotate-12 whitespace-nowrap">
                    {symbol}
                </span>
            </div>

            <div className="relative z-10 flex flex-col gap-6">
                {/* Title Section */}
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
                        个股情况
                    </h1>
                    <div className="h-1 w-12 bg-emerald-500 rounded-full" />
                </div>

                {/* Symbol Card */}
                <div className="flex items-center">
                    <div className="flex items-center gap-3 px-6 py-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 backdrop-blur-sm">
                        <CompanyLogo symbol={symbol} size={32} className="w-8 h-8" />

                        <div className="flex items-baseline gap-2">
                            <span className="text-xl font-bold text-emerald-400 tracking-wide">
                                {symbol}
                            </span>
                            {name && (
                                <span className="text-sm text-slate-400 font-medium">
                                    {name}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
