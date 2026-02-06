
import { collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { initializeFirebase } from '@/firebase';

const { firestore: db } = initializeFirebase();

/**
 * Invalidates snapshots that are potentially stale due to a transaction change.
 * This ensures data consistency by forcing a recalculation for affected periods.
 * 
 * Strategy:
 * When a transaction at Date X is modified/added/deleted, 
 * ANY snapshot with date >= Date X is inherently invalid because it *should* have included 
 * (or excluded) this transaction's impact.
 * 
 * We delete all such snapshots. The next page load will naturally fall back 
 * to an earlier valid snapshot (or full recalc if none exist) and replay history correctly.
 */
export async function invalidateSnapshots(uid: string, txDateStr: string) {
    if (!uid || !txDateStr) {
        console.warn('[Invalidation] Missing uid or txDateStr');
        return;
    }

    const snapsRef = collection(db, 'users', uid, 'snapshots');
    // Find all snapshots where snapshot date >= txDateStr
    // String comparison works for YYYY-MM-DD
    const q = query(snapsRef, where('date', '>=', txDateStr));

    try {
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            console.log(`[Invalidation] No snapshots affected by change on ${txDateStr}`);
            return;
        }

        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`[Invalidation] 🗑️ Deleted ${querySnapshot.size} stale snapshots >= ${txDateStr}`);

    } catch (err) {
        console.error('[Invalidation] Failed to delete stale snapshots:', err);
        // We log error but don't block. Worst case: User sees stale data until next full refresh or manual calc.
        // Ideally we should throw to alert UI? For now, silent fail is safer for UX flow, 
        // effectively consistency is "eventual" if this fails.
    }
}
