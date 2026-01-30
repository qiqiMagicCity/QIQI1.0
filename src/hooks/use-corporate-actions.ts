
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { SplitEvent, DEFAULT_STOCK_SPLITS } from '@/lib/holdings/stock-splits';

// Hook to fetch corporate actions (splits) from Firestore
export function useCorporateActions() {
    const firestore = useFirestore();
    const [splits, setSplits] = useState<SplitEvent[]>(DEFAULT_STOCK_SPLITS); // Default to hardcoded safe list
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!firestore) return;

        const colRef = collection(firestore, 'corporate_actions');
        // We only care about splits for now
        const q = query(colRef, where('type', '==', 'SPLIT'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedSplits: SplitEvent[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Map Firestore data to SplitEvent interface
                // Ensure field mapping matches migration script
                if (data.symbol && data.effectiveDate && data.ratio) {
                    fetchedSplits.push({
                        symbol: data.symbol,
                        effectiveDate: data.effectiveDate,
                        splitRatio: Number(data.ratio) // Ensure number
                    });
                }
            });

            if (fetchedSplits.length > 0) {
                // Sort by date just in case
                fetchedSplits.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
                setSplits(fetchedSplits);
            }
            setLoading(false);
        }, (error) => {
            console.error("Failed to fetch corporate actions:", error);
            // On error, keep using defaults (safe fallback)
            setLoading(false);
        });

        return () => unsubscribe();
    }, [firestore]);

    return { splits, loading };
}
