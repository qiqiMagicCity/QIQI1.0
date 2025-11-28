'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

function EditorRedirector() {
    const router = useRouter();
    const sp = useSearchParams();
    const pathname = usePathname();

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

    return null;
}

export default function TransactionEditorPage() {
    return (
        <Suspense fallback={null}>
            <EditorRedirector />
        </Suspense>
    );
}
