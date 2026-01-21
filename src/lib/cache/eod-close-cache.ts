/**
 * Simple IndexedDB wrapper for EOD Close Data.
 * 
 * Purpose:
 * Reduce Firestore Reads by caching official close data in the browser.
 * Data is immutable for a given trading day and symbol (official close doesn't change).
 * 
 * Schema Update V2 (Rev Support):
 * DB Name: 'QIQI_EOD_CACHE'
 * Store Name: 'officialCloses'
 * Key: `${date}_${symbol}`
 * Value: CachedOfficialClose (includes rev, symbol)
 * Index: 'symbol' -> 'symbol' (for clearing cache by symbol)
 */

import { type OfficialCloseResult } from '@/lib/data/official-close-repo';

const DB_NAME = 'QIQI_EOD_CACHE';
const STORE_NAME = 'officialCloses';
const DB_VERSION = 2; // Bumped for 'symbol' index

export interface CachedOfficialClose extends OfficialCloseResult {
    rev?: number; // Revision number for cache invalidation (e.g. stock split)
    symbol?: string; // Indexed for clearing
    updatedAt?: number;
}

interface CacheDB {
    get(key: string): Promise<CachedOfficialClose | undefined>;
    getMany(keys: string[]): Promise<Record<string, CachedOfficialClose>>;
    set(key: string, value: CachedOfficialClose): Promise<void>;
    setMany(entries: Record<string, CachedOfficialClose>): Promise<void>;
    clear(): Promise<void>;
    clearSymbols(symbols: string[]): Promise<void>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    if (typeof window === 'undefined') {
        return Promise.reject(new Error('IndexedDB not available server-side'));
    }

    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const tx = (event.target as IDBOpenDBRequest).transaction;

            let store: IDBObjectStore;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                store = db.createObjectStore(STORE_NAME);
            } else {
                store = tx!.objectStore(STORE_NAME);
            }

            // V2: Add symbol index
            if (!store.indexNames.contains('symbol')) {
                store.createIndex('symbol', 'symbol', { unique: false });
            }
        };

        req.onsuccess = (event) => {
            resolve((event.target as IDBOpenDBRequest).result);
        };

        req.onerror = (event) => {
            reject((event.target as IDBOpenDBRequest).error);
        };
    });

    return dbPromise;
}

export const EodCache: CacheDB = {
    async get(key: string): Promise<CachedOfficialClose | undefined> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.warn('[EodCache] Read failed', e);
            return undefined;
        }
    },

    async getMany(keys: string[]): Promise<Record<string, CachedOfficialClose>> {
        if (keys.length === 0) return {};
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const results: Record<string, CachedOfficialClose> = {};
                let completed = 0;

                keys.forEach(key => {
                    const req = store.get(key);
                    req.onsuccess = () => {
                        if (req.result) {
                            results[key] = req.result;
                        }
                        completed++;
                        if (completed === keys.length) resolve(results);
                    };
                    req.onerror = () => {
                        completed++;
                        if (completed === keys.length) resolve(results);
                    };
                });
            });
        } catch (e) {
            console.warn('[EodCache] Bulk read failed', e);
            return {};
        }
    },

    async set(key: string, value: CachedOfficialClose): Promise<void> {
        if (value.status !== 'ok') return;

        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.warn('[EodCache] Write failed', e);
        }
    },

    async setMany(entries: Record<string, CachedOfficialClose>): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);

                Object.entries(entries).forEach(([key, val]) => {
                    if (val.status === 'ok') {
                        store.put(val, key);
                    }
                });

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('[EodCache] Bulk write failed', e);
        }
    },

    async clear(): Promise<void> {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async clearSymbols(symbols: string[]): Promise<void> {
        if (symbols.length === 0) return;
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const index = store.index('symbol');

                let completed = 0;

                symbols.forEach(sym => {
                    const req = index.getAllKeys(sym);
                    req.onsuccess = () => {
                        const keys = req.result;
                        if (keys && keys.length > 0) {
                            keys.forEach(k => {
                                store.delete(k);
                            });
                        }
                        completed++;
                        if (completed === symbols.length) {
                            // finished
                        }
                    };
                    req.onerror = () => {
                        console.warn('[EodCache] Failed to clear symbol', sym);
                        completed++;
                    }
                });

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

        } catch (e) {
            console.warn('[EodCache] Clear symbols failed', e);
        }
    }
};
