'use client';

import { useMemo, useState } from 'react';
import symbolDomains from '@/data/symbol_domains.json';
import { Building2 } from 'lucide-react';

interface CompanyLogoProps {
    symbol: string;
    underlying?: string; // [NEW] Support underlying logic
    size?: number;
    className?: string;
}

// Cast the JSON to a Record<string, string> to avoid type errors
const domains = symbolDomains as Record<string, string>;

export function CompanyLogo({ symbol, underlying, size = 32, className = '' }: CompanyLogoProps) {
    const [error, setError] = useState(false);

    const targetSymbol = underlying || symbol;

    const domain = useMemo(() => {
        // Try exact match, ensure upper case
        const key = targetSymbol.toUpperCase();
        if (domains[key]) return domains[key];
        return null;
    }, [targetSymbol]);

    const logoUrl = domain
        ? `https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}`
        : null;

    if (!logoUrl || error) {
        return (
            <div
                className={`flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400 shrink-0 ${className}`}
                style={{ width: size, height: size }}
            >
                <Building2 size={size * 0.6} />
            </div>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={logoUrl}
            alt={`${targetSymbol} logo`}
            width={size}
            height={size}
            // Add shrink-0 to prevent flex compression
            className={`rounded-full object-contain bg-white dark:bg-white/90 p-0.5 shrink-0 ${className}`}
            style={{ width: size, height: size, minWidth: size, minHeight: size }}
            onError={() => setError(true)}
        />
    );
}
