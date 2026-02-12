/**
 * PNL Snapshot Synchronization Channel
 * Primary: BroadcastChannel API (Chrome 54+, Safari 15.4+, Firefox 38+)
 * MDN Reference: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel#browser_compatibility
 * Baseline 2022 Decision: https://web.dev/baseline/2022/
 * 
 * Fallback: localStorage 'storage' event.
 * Note: Storage events only trigger in OTHER tabs/documents, satisfying Rule A of P.09.
 */

// No top-level side effects using window/localStorage
// Satisfies EC 10A Rule 2: Delay initialization.

export interface PnlSyncMessage {
    type: 'SNAPSHOT_INVALIDATED';
    uid: string;
    txDateStr: string;
    txRevision: number;
}

const STORAGE_KEY = 'qiqi_bc_fallback';

/**
 * Broadcasts an invalidation event.
 */
export function broadcastSnapshotInvalidation(uid: string, txDateStr: string, txRevision: number) {
    const payload: PnlSyncMessage = { type: 'SNAPSHOT_INVALIDATED', uid, txDateStr, txRevision };

    // 1. Primary: BroadcastChannel
    if (typeof window !== 'undefined' && window.BroadcastChannel) {
        try {
            const bc = new BroadcastChannel(`qiqi_pnl_sync_${uid}`);
            bc.postMessage(payload);
            bc.close();
        } catch (e) {
            console.warn('[Broadcast] BC Fail, using LS fallback', e);
        }
    }

    // 2. Fallback: LocalStorage (Always set as backup)
    if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, _ts: Date.now() }));
    }

    console.log(`[Broadcast] Sent SNAPSHOT_INVALIDATED for ${txDateStr} (Rev: ${txRevision})`);
}

/**
 * Subscribes to the synchronization channel.
 */
export function subscribeToPnlSync(uid: string, onMessage: (msg: PnlSyncMessage) => void) {
    if (typeof window === 'undefined') return () => { };

    let mode: 'BC' | 'LS' = 'LS';
    const hasBC = !!window.BroadcastChannel;
    console.log(`[Compatibility] BroadcastChannel Supported: ${hasBC}. Fallback Mode: ${!hasBC ? 'storage_event' : 'enabled'}`);

    // A. Primary Path: BroadcastChannel (Native Support)
    if (window.BroadcastChannel) {
        mode = 'BC';
        const bc = new BroadcastChannel(`qiqi_pnl_sync_${uid}`);
        bc.onmessage = (event) => {
            if (event.data?.uid === uid) onMessage(event.data);
        };
        console.log(`[Broadcast] Subscribed to TabSync (Mode: ${mode})`);
        return () => bc.close();
    }

    // B. Fallback Path: LocalStorage (Legacy browsers)
    // Satisfies Rule 1: storage event only triggers for OTHER documents.
    const storageHandler = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY && e.newValue) {
            try {
                const msg = JSON.parse(e.newValue);
                if (msg.uid === uid) onMessage(msg);
            } catch (err) { /* ignore parse error */ }
        }
    };
    window.addEventListener('storage', storageHandler);
    console.log(`[Broadcast] Subscribed to TabSync (Mode: ${mode})`);

    return () => {
        window.removeEventListener('storage', storageHandler);
    };
}
