'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';





export default function TransactionEditorPage() {
    const router = useRouter();
    const sp = useSearchParams();
    const pathname = usePathname(); // Included as per user request

    useEffect(() => {
        const id = sp.get('id');
        const symbol = sp.get('symbol');
        let targetPath = '/';
        let query = '';

        if (id) {
            query = `tx=edit&id=${id}`;
        } else {
            query = `tx=new`;
        }

        if (symbol) {
            query += `&symbol=${symbol}`;
        }

        router.replace(`${targetPath}?${query}`);
    }, [sp, router]);

    return null; // This page no longer renders anything, it just redirects
}
