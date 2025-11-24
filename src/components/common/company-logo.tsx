'use client';

import { useMemo, useState } from 'react';
import symbolDomains from '@/data/symbol_domains.json';
import { Building2 } from 'lucide-react';

interface CompanyLogoProps {
    symbol: string;
    size?: number;
    className?: string;
}

// Cast the JSON to a Record<string, string> to avoid type errors
const domains = symbolDomains as Record<string, string>;

export function CompanyLogo({ symbol, size = 32, className = '' }: CompanyLogoProps) {
    const [error, setError] = useState(false);

    const domain = useMemo(() => {
        // Try exact match
        if (domains[symbol]) return domains[symbol];

        // Try removing suffixes like .B (e.g. BRK.B -> BRK -> berkshirehathaway.com? Need to handle manually if not in map)
        // For now, just return null if not found
        return null;
    }, [symbol]);

    const logoUrl = domain
        ? `https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}` // Request 2x size for retina
        : null;

    if (!logoUrl || error) {
        return (
            <div
                className={`flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400 ${className}`}
                style={{ width: size, height: size }}
            >
                <Building2 size={size * 0.6} />
            </div>
        );
    }

    return (
        <img
            src={logoUrl}
            alt={`${symbol} logo`}
            width={size}
            height={size}
            className={`rounded-full object-contain ${className}`}
            onError={() => setError(true)}
        />
    );
}
