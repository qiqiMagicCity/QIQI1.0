
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
    FieldValue,
    increment,
    writeBatch,
    documentId
} from 'firebase/firestore';
import { initializeFirebase } from '@/firebase';

const { firestore: db } = initializeFirebase();

/**
 * [EC 10A Rule 2] SSR Security Agreement: Delay Initialization.
 * No side-effects at module top-level.
 */
function isDebug() {
    if (typeof window === 'undefined') return false;
    try {
        return !!(new URLSearchParams(window.location.search).get('debug')) || !!localStorage.getItem('qiqi_debug');
    } catch (e) {
        return false;
    }
}

function ensureStatsInit() {
    if (typeof window === 'undefined') return false;
    if (!isDebug()) return false;
    if (!(window as any).__FIREBASE_STATS__) {
        (window as any).__FIREBASE_STATS__ = {
            getDoc: 0,
            getDocs: 0,
            setDoc: 0,
            updateDoc: 0,
            batchCommit: 0,
            snapshotHit: 0,
            snapshotMiss: 0,
            snapshotStale: 0
        };
        console.log(`[Audit] Billing instrumentation enabled (Client-Side).`);
    }
    return true;
}

const BREAKER_CONFIG = {
    MAX_SESSION_SETS: 10,
    MAX_MONTHLY_SETS: 3,
    STALE_THRESHOLD: 0.3,
    MIN_SAMPLES: 5,
    COOLDOWN_MS: 120000,
};

function ensureBreakerInit() {
    if (typeof window === 'undefined') return null;
    if (!(window as any).__PNL_BREAKER__) {
        (window as any).__PNL_BREAKER__ = {
            state: 'CLOSED', // CLOSED, OPEN
            lastOpenTs: 0,
            monthWriteCount: {} as Record<string, number>,
            sessionWrites: 0,
            consequentHits: 0
        };
        console.log(`[Breaker] Initialization (Client-Side).`);
    }
    return (window as any).__PNL_BREAKER__;
}

export function countCall(type: 'getDoc' | 'getDocs' | 'setDoc' | 'updateDoc' | 'batchCommit' | 'snapshotHit' | 'snapshotMiss' | 'snapshotStale') {
    if (ensureStatsInit()) {
        (window as any).__FIREBASE_STATS__[type]++;
    }
}

export function getBreakerState(): 'CLOSED' | 'OPEN' {
    const breaker = ensureBreakerInit();
    if (!breaker) return 'CLOSED';

    if (breaker.state === 'OPEN' && (Date.now() - breaker.lastOpenTs > BREAKER_CONFIG.COOLDOWN_MS)) {
        console.log(`[Breaker] 🔋 Cooldown expired. Recovering to CLOSED.`);
        breaker.state = 'CLOSED';
        breaker.consequentHits = 0;
    }
    return breaker.state;
}

export function reportPnLHit() {
    const breaker = ensureBreakerInit();
    if (breaker && breaker.state === 'OPEN') {
        breaker.consequentHits++;
        if (breaker.consequentHits >= 2) {
            console.log(`[Breaker] 🎯 Consistent HITs detected. Recovering to CLOSED.`);
            breaker.state = 'CLOSED';
            breaker.consequentHits = 0;
        }
    }
    countCall('snapshotHit');
}

export interface PnlSnapshotFingerprint {
    txRevision: number;
    eodFingerprint: string;
    calcEngineVersion: string;
    splitsRevision: string;
    fxRevision: string;
    eodFingerprintScope: "symbolRevGlobal";
}

export interface PnlSnapshot {
    monthId: string;
    fingerprint: PnlSnapshotFingerprint;
    data: {
        totalPnlCents: number;
        dailyTotalPnlCents: (number | null)[];
        bySymbolMonth?: Record<string, { totalPnlCents: number }>;
    };
    meta: {
        symbols: string[];
        computedAt: any;
        isTrimmed?: boolean;
        trimReason?: string;
        originalBytes?: number;
    };
}

export const CALC_ENGINE_VERSION = '4.1.0-MVP-G2';
export const MAX_SNAPSHOT_BYTES = 900 * 1024;

export async function getPnlSnapshot(uid: string, monthId: string): Promise<PnlSnapshot | null> {
    const docRef = doc(db, 'pnlSnapshots', uid, 'months', monthId);
    countCall('getDoc');
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as PnlSnapshot;
}

export async function savePnlSnapshot(uid: string, snapshot: Omit<PnlSnapshot, 'meta'> & { symbols: string[] }) {
    const breaker = ensureBreakerInit();
    if (breaker) {
        const monthlyWrites = (breaker.monthWriteCount[snapshot.monthId] || 0);
        if (monthlyWrites >= BREAKER_CONFIG.MAX_MONTHLY_SETS) {
            if (breaker.state === 'CLOSED') {
                breaker.state = 'OPEN';
                breaker.lastOpenTs = Date.now();
                console.error(`[Breaker] 🚨 OPEN (Reason: MonthlyLimit) | Month: ${snapshot.monthId} | Writes: ${monthlyWrites}`);
            }
            return;
        }

        if (breaker.sessionWrites >= BREAKER_CONFIG.MAX_SESSION_SETS) {
            if (breaker.state === 'CLOSED') {
                breaker.state = 'OPEN';
                breaker.lastOpenTs = Date.now();
                console.error(`[Breaker] 🚨 OPEN (Reason: SessionLimit) | Writes: ${breaker.sessionWrites}`);
            }
            return;
        }

        const audit = (window as any).__PNL_AUDIT__;
        if (audit && audit.total >= BREAKER_CONFIG.MIN_SAMPLES) {
            const staleRate = audit.stal / audit.total;
            if (staleRate > BREAKER_CONFIG.STALE_THRESHOLD) {
                if (breaker.state === 'CLOSED') {
                    breaker.state = 'OPEN';
                    breaker.lastOpenTs = Date.now();
                    console.error(`[Breaker] 🚨 OPEN (Reason: HighStaleRate) | Rate: ${(staleRate * 100).toFixed(1)}%`);
                }
                return;
            }
        }
    }

    const docRef = doc(db, 'pnlSnapshots', uid, 'months', snapshot.monthId);
    let payload: PnlSnapshot = { ...snapshot, meta: { symbols: snapshot.symbols, computedAt: serverTimestamp() } };

    const encoder = new TextEncoder();
    let bytes = encoder.encode(JSON.stringify(payload)).length;
    if (bytes > MAX_SNAPSHOT_BYTES) {
        payload.meta.isTrimmed = true;
        payload.meta.trimReason = "docTooLarge";
        if (payload.data.bySymbolMonth) delete payload.data.bySymbolMonth;
        bytes = encoder.encode(JSON.stringify(payload)).length;
    }

    await setDoc(docRef, payload);
    countCall('setDoc');

    if (breaker) {
        breaker.sessionWrites++;
        breaker.monthWriteCount[snapshot.monthId] = (breaker.monthWriteCount[snapshot.monthId] || 0) + 1;
    }
    console.log(`[PnlSnapshot] Saved ${snapshot.monthId} (Size: ${bytes}B, SessionTotal: ${breaker?.sessionWrites})`);
}

export async function getGlobalTxRevision(uid: string): Promise<number> {
    countCall('getDoc');
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return 0;
    return snap.data().txRevision || 0;
}

export function getTxRevisionIncrement(uid: string) {
    const userRef = doc(db, 'users', uid);
    return {
        ref: userRef,
        data: {
            txRevision: increment(1),
            updatedAt: serverTimestamp()
        }
    };
}

async function computeHash(message: string): Promise<string> {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
        const crypto = await import('crypto');
        return crypto.createHash('sha256').update(message).digest('hex');
    }
}

export async function generateEodFingerprint(revisions: { symbol: string; eodRevision: number }[]): Promise<string> {
    const sorted = [...revisions].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const rawString = sorted.map(r => `${r.symbol}:${r.eodRevision}`).join('|');
    return await computeHash(rawString);
}
