
import { useState, useEffect } from 'react';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { useUser, useFirestore } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertTriangle, Trash2, Wrench, RefreshCw, Layers } from 'lucide-react';
import { format } from 'date-fns';
import { nyLocalDateTimeToUtcMillis, toNyCalendarDayString, toNyHmsString } from '@/lib/ny-time';



type IssueType = 'OFFSET_ERROR' | 'DUPLICATE_PHANTOM' | 'CROSS_COLLECTION_DUPE' | 'LEGACY_FORMAT' | 'DIRTY_DATA' | 'RAPID_DUPLICATE';

interface IssueItem {
    id: string;
    collection: 'transactions' | 'trades';
    symbol: string;
    desc: string;
    type: IssueType;
    currentDateNy: string;
    currentTime: string;
    currentTs: number;
    expectedTs?: number;
    diffHours: number;
    pairId?: string;
    pairCollection?: 'transactions' | 'trades';
}

interface FlatRecord {
    id: string;
    collection: 'transactions' | 'trades';
    data: any;
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    transactionDateNy: string;
    time: string;
    transactionTimestamp: number;
    timestampSource: 'explicit' | 'derived';
    createdAt: number;
    correctTs?: number;
}

export function DataHealthCheck() {
    const { user } = useUser();
    const firestore = useFirestore();

    const [scanning, setScanning] = useState(false);
    const [fixing, setFixing] = useState(false);
    const [issues, setIssues] = useState<IssueItem[]>([]);
    const [scanStats, setScanStats] = useState({ txCount: 0, tradesCount: 0 });
    const [message, setMessage] = useState<string | null>(null);
    const [nflxDebugDump, setNflxDebugDump] = useState<any[]>([]);

    const runScan = async () => {
        if (!user) return;
        setScanning(true);
        setIssues([]);
        setMessage(null);
        setNflxDebugDump([]);

        try {
            // 1. Fetch BOTH Collections
            const txRef = collection(firestore, 'users', user.uid, 'transactions');
            const trTxRef = collection(firestore, 'users', user.uid, 'trades');

            const [txSnap, trSnap] = await Promise.all([
                getDocs(txRef),
                getDocs(trTxRef)
            ]);

            setScanStats({ txCount: txSnap.size, tradesCount: trSnap.size });

            // 2. Normalize Data into a single Flat List
            const allRecords: FlatRecord[] = [];
            const foundIssues: IssueItem[] = [];

            const processDoc = (doc: any, colName: 'transactions' | 'trades') => {
                const d = doc.data();
                if (!d.symbol) return;

                const symbol = (d.symbol || '').trim().toUpperCase();

                // Check for Legacy/Dirty Fields strictly BEFORE normalization
                const isModern = d.transactionDateNy && d.transactionTimestamp && typeof d.transactionTimestamp === 'number' && d.time;
                let legacyType: IssueType | null = null;
                let legacyDesc = '';

                if (!isModern) {
                    if (d.tradeDate) {
                        legacyType = 'LEGACY_FORMAT';
                        legacyDesc = '旧格式 (含 tradeDate)';
                    } else if (d.transactionDate && !d.transactionDateNy) {
                        legacyType = 'LEGACY_FORMAT';
                        legacyDesc = '旧格式 (含 transactionDate)';
                    } else if (!d.transactionTimestamp) {
                        legacyType = 'DIRTY_DATA';
                        legacyDesc = '脏数据 (无时间戳)';
                    } else if (!d.transactionDateNy) {
                        legacyType = 'DIRTY_DATA';
                        legacyDesc = '脏数据 (无日期字符串)';
                    }
                }

                // ... normalization proceeds to see if we can salvage it for duplicate checking ...

                // Side Map
                let side = (d.side || d.action || d.type || '').toUpperCase();
                if (side.includes('BUY') || side.includes('COVER')) side = 'BUY';
                else if (side.includes('SELL') || side.includes('SHORT')) side = 'SELL';

                // Qty & Price
                const quantity = Number(d.quantity || d.qty || d.shares || 0);
                const price = Number(d.price || d.fillPrice || d.avgPrice || 0);

                // Timestamp
                let ts = Number(d.transactionTimestamp || d.timestamp || 0);
                // Handle Firestore Timestamp object if present
                if (d.transactionTimestamp && typeof d.transactionTimestamp.toMillis === 'function') {
                    ts = d.transactionTimestamp.toMillis();
                } else if (d.tradeDate && typeof d.tradeDate.toMillis === 'function') {
                    ts = d.tradeDate.toMillis(); // Fallback for sorting
                }

                // Date & Time
                let dateNy = d.transactionDateNy;
                let timeStr = d.time;
                let tsSource: 'explicit' | 'derived' = 'explicit';

                // If missing, derive from TS
                if (!dateNy || !timeStr) {
                    if (ts > 0) {
                        const derived = { dateNy: toNyCalendarDayString(ts), time: toNyHmsString(ts) };
                        if (!dateNy) {
                            dateNy = derived.dateNy;
                            tsSource = 'derived';
                        }
                        if (!timeStr) {
                            timeStr = derived.time;
                            tsSource = 'derived';
                        }
                    } else if (d.transactionDate) {
                        // Legacy field support?
                        if (/^\d{4}-\d{2}-\d{2}$/.test(d.transactionDate)) dateNy = d.transactionDate;
                    }
                }

                // If absolutely no time info, AND we already flagged it as strict legacy, 
                // we still push it to issues now if we haven't.
                // But let's finish the flat record for duplicate checking if possible.

                if (legacyType) {
                    foundIssues.push({
                        id: doc.id,
                        collection: colName,
                        symbol,
                        desc: legacyDesc,
                        type: legacyType,
                        currentDateNy: dateNy || 'INVALID',
                        currentTime: timeStr || '??:??',
                        currentTs: ts,
                        diffHours: 0
                    });
                    // Do NOT add to allRecords if it is dirty/legacy?
                    // Actually, if we add it, we might find it duplicates a modern record.
                    // But if the instructions are "Filter out all... formats unexpected", we strictly flag them.
                    // The user might want to see them.
                    // We will Add to allRecords so we can see if they are also dupes (Double Bad).
                }

                if (!dateNy || !timeStr || !ts) {
                    return; // Too broken to analyze offset
                }

                // Strict Parse for timeStr to ensure format
                // If timeStr is "13:52", treat as "13:52:00"
                if (timeStr.split(':').length === 2) timeStr += ':00';

                // Calculate "Correct TS" based on DateNy + Time
                const correctTs = nyLocalDateTimeToUtcMillis(dateNy, timeStr);

                // CreatedAt extraction (Robust)
                let createdAt = 0;
                if (d.createdAt) {
                    if (typeof d.createdAt === 'number') createdAt = d.createdAt;
                    else if (typeof d.createdAt.toMillis === 'function') createdAt = d.createdAt.toMillis();
                }

                allRecords.push({
                    id: doc.id,
                    collection: colName,
                    data: d,
                    symbol,
                    side,
                    quantity: Math.abs(quantity),
                    price: Math.abs(price),
                    transactionDateNy: dateNy,
                    time: timeStr,
                    transactionTimestamp: ts,
                    timestampSource: tsSource as any,
                    createdAt,
                    correctTs
                });
            };

            txSnap.docs.forEach(d => processDoc(d, 'transactions'));
            trSnap.docs.forEach(d => processDoc(d, 'trades'));

            // --- DEBUG TRACER ---
            // Dump EVERYTHING for 2025-10-21 to see what actually persisted
            const targetDateDump = allRecords.filter(r => r.transactionDateNy === '2025-10-21');

            if (targetDateDump.length > 0) {
                const dump = targetDateDump.map(r => ({
                    id: r.id,
                    symbol: r.symbol, // Important to see what symbols exist
                    collection: r.collection,
                    dateNy: r.transactionDateNy,
                    time: r.time,
                    qty: r.quantity,
                    price: r.price,
                    side: r.side,
                    ts: r.transactionTimestamp,
                    createdAt: r.data.createdAt ? new Date(r.data.createdAt).toISOString() : 'N/A' // Check if they are new
                }));
                // Sort by time
                dump.sort((a, b) => (a.ts || 0) - (b.ts || 0));

                setNflxDebugDump(dump);
            }
            // --------------------

            // 3. Scan for Offset Errors (Skip if already flagged as Legacy)
            allRecords.forEach(rec => {
                if (foundIssues.some(i => i.id === rec.id)) return; // Skip already bad ones
                if (rec.timestampSource === 'derived') return;

                const diff = rec.correctTs! - rec.transactionTimestamp;
                if (Math.abs(diff) > 1000) {
                    const diffHrs = diff / 3600000;
                    foundIssues.push({
                        id: rec.id,
                        collection: rec.collection,
                        symbol: rec.symbol,
                        desc: `${rec.transactionDateNy} ${rec.time} (via ${rec.collection})`,
                        type: 'OFFSET_ERROR',
                        currentDateNy: rec.transactionDateNy,
                        currentTime: rec.time,
                        currentTs: rec.transactionTimestamp,
                        expectedTs: rec.correctTs!,
                        diffHours: diffHrs
                    });
                }
            });

            // 4. Scan for Duplicates (Fingerprint Match)
            const groupings = new Map<string, FlatRecord[]>();

            allRecords.forEach(rec => {
                const pKey = rec.price.toFixed(4);
                const qKey = rec.quantity.toFixed(4);
                const dKey = (rec.transactionDateNy || 'UNKNOWN_DATE').trim();
                const tKey = (rec.time || '00:00:00').trim();

                // Fingerprint: Symbol | Side | Qty | Price | Date | Time
                const key = `${rec.symbol}|${rec.side}|${qKey}|${pKey}|${dKey}|${tKey}`;

                if (!groupings.has(key)) groupings.set(key, []);
                groupings.get(key)!.push(rec);
            });

            groupings.forEach((group, key) => {
                if (group.length > 1) {
                    // Sort by Quality (Best first)
                    // Criteria:
                    // 1. Transactions collection is preferred over Trades (Migration)
                    // 2. Explicit Timestamp preferred over Derived
                    // 3. Valid Date format preferred
                    group.sort((a, b) => {
                        // Pref: 'transactions' > 'trades'
                        if (a.collection === 'transactions' && b.collection === 'trades') return -1;
                        if (a.collection === 'trades' && b.collection === 'transactions') return 1;

                        // Pref: Explicit Source > Derived
                        if (a.timestampSource === 'explicit' && b.timestampSource === 'derived') return -1;
                        if (a.timestampSource === 'derived' && b.timestampSource === 'explicit') return 1;

                        return 0;
                    });

                    const keeper = group[0];
                    const others = group.slice(1);

                    others.forEach(p => {
                        // Skip if already flagged as Legacy (it will be deleted anyway)
                        if (foundIssues.some(i => i.id === p.id)) return;

                        // Case 1: Cross-Collection (Always Bad)
                        // Case 1: Cross-Collection (Always Bad)
                        const isCrossCollection = keeper.collection !== p.collection;

                        // Case 2: Quality Mismatch (Good vs Bad)
                        const isQualityDiff = keeper.timestampSource === 'explicit' && p.timestampSource === 'derived';

                        // Case 3: Legitimate Duplicates (User Intent)
                        // If Same Collection AND Both Good Quality -> ASSUME VALID.
                        let isSafeDuplicate = !isCrossCollection && !isQualityDiff;

                        // [RAPID FIRE DETECTION]
                        // Even if it looks "Safe" (Same collection, same quality),
                        // if they were created within 3 seconds of each other, it's a Race Condition Bug.
                        let isRapidFire = false;
                        if (isSafeDuplicate && keeper.createdAt && p.createdAt) {
                            const createDiff = Math.abs(keeper.createdAt - p.createdAt);
                            if (createDiff < 3000) { // 3 seconds window
                                isSafeDuplicate = false; // Revoke safety
                                isRapidFire = true;
                            }
                        }

                        if (isSafeDuplicate) {
                            return;
                        }

                        const existingInfo = foundIssues.find(iss => iss.id === p.id);

                        let issueType: IssueType = 'DUPLICATE_PHANTOM';
                        let diffDesc = "";

                        if (isRapidFire) {
                            issueType = 'RAPID_DUPLICATE';
                            diffDesc = " (短时连击重复)";
                        } else if (isCrossCollection) {
                            issueType = 'CROSS_COLLECTION_DUPE';
                            diffDesc = ` (vs ${keeper.collection})`;
                        } else if (isQualityDiff) {
                            issueType = 'DUPLICATE_PHANTOM'; // Or a new type "CORRUPT_DUPE"
                            diffDesc = " (Low Quality)";
                        }

                        if (!existingInfo) {
                            foundIssues.push({
                                id: p.id,
                                collection: p.collection,
                                symbol: p.symbol,
                                desc: `${p.transactionDateNy} ${p.time}${diffDesc}`,
                                type: issueType,
                                currentDateNy: p.transactionDateNy,
                                currentTime: p.time,
                                currentTs: p.transactionTimestamp,
                                expectedTs: p.transactionTimestamp,
                                diffHours: 0,
                                pairId: keeper.id,
                                pairCollection: keeper.collection
                            });
                        }
                    });
                }
            });

            setIssues(foundIssues);

        } catch (err: any) {
            console.error(err);
            setMessage('扫描失败: ' + err.message);
        } finally {
            setScanning(false);
        }
    };

    const executeFix = async () => {
        if (!user || issues.length === 0) return;
        setFixing(true);

        try {
            const batch = writeBatch(firestore);
            let fixCount = 0;
            let deleteCount = 0;

            for (const issue of issues) {
                const colName = issue.collection || 'transactions';
                const ref = doc(firestore, 'users', user.uid, colName, issue.id);

                if (issue.type === 'DUPLICATE_PHANTOM' || issue.type === 'CROSS_COLLECTION_DUPE' || issue.type === 'RAPID_DUPLICATE') {
                    // Standard Dupe -> Delete
                    batch.delete(ref);
                    deleteCount++;
                } else if (issue.type === 'LEGACY_FORMAT' || issue.type === 'DIRTY_DATA') {
                    // Legacy/Dirty -> Strictly Delete (Cleaning)
                    batch.delete(ref);
                    deleteCount++;
                } else if (issue.type === 'OFFSET_ERROR') {
                    if (issue.expectedTs) {
                        batch.update(ref, {
                            transactionTimestamp: issue.expectedTs,
                            updatedAt: Date.now()
                        });
                        fixCount++;
                    }
                }
            }

            await batch.commit();
            setMessage(`处理完成! 修正 ${fixCount} 条，删除 ${deleteCount} 条。`);
            setIssues([]);
        } catch (err: any) {
            setMessage('修复失败: ' + err.message);
        } finally {
            setFixing(false);
        }
    };

    return (
        <Card className="mt-8 border-blue-500/50 bg-blue-500/5">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-600">
                    <Layers className="h-5 w-5" />
                    全域数据审计 (Transactions + Trades)
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        此工具现在会同时扫描 transactions 和 trades 两个数据源，彻底排查跨集合重复、时区偏差、同步冲突以**及非标准格式数据**。
                    </p>

                    <div className="flex gap-4 items-center flex-wrap">
                        <Button onClick={runScan} disabled={scanning || fixing} variant="outline">
                            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            {scanning ? '全域扫描中...' : '开始深度审计'}
                        </Button>
                        {(scanStats.txCount > 0 || scanStats.tradesCount > 0) && (
                            <div className="text-xs text-gray-500 flex gap-2">
                                <span className="px-2 py-1 bg-gray-100 rounded">Transactions: {scanStats.txCount}</span>
                                <span className="px-2 py-1 bg-gray-100 rounded">Trades: {scanStats.tradesCount}</span>
                            </div>
                        )}
                    </div>

                    {nflxDebugDump.length > 0 && (
                        <div className="mt-4 p-4 bg-slate-100 dark:bg-slate-900 rounded border border-slate-300 font-mono text-xs overflow-x-auto">
                            <h4 className="font-bold mb-2 text-slate-700 dark:text-slate-300">🕵️ 2025-10-21 FULL DATA DUMP (Raw Data)</h4>
                            <pre>{JSON.stringify(nflxDebugDump, null, 2)}</pre>
                        </div>
                    )}

                    {issues.length > 0 && (
                        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 dark:bg-red-900/20">
                            <h4 className="font-bold text-red-700 dark:text-red-400 mb-2 flex items-center justify-between">
                                <span>发现 {issues.length} 个异常:</span>
                                <Button size="sm" onClick={executeFix} disabled={fixing} variant="destructive">
                                    {fixing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                    一键清洗 (修正/删除)
                                </Button>
                            </h4>
                            <div className="max-h-80 overflow-y-auto space-y-1 text-sm mb-4 pr-2">
                                {issues.map(iss => (
                                    <div key={iss.id} className="flex justify-between items-center bg-white dark:bg-black/20 p-2 rounded border border-red-100 dark:border-red-900/30">
                                        <div className="flex flex-col">
                                            <span className="font-medium">
                                                <span className="font-mono font-bold mr-2 text-blue-600 dark:text-blue-400">{iss.symbol}</span>
                                                {iss.currentDateNy} {iss.currentTime}
                                            </span>
                                            <span className="text-xs text-gray-500">
                                                src: {iss.collection} • {iss.type} {iss.type === 'OFFSET_ERROR' ? `(${iss.diffHours.toFixed(1)}h)` : ''}
                                                {(iss.type === 'LEGACY_FORMAT' || iss.type === 'DIRTY_DATA') && <span className="text-red-600 font-bold ml-1">[{iss.desc}]</span>}
                                            </span>
                                        </div>
                                        {iss.type === 'CROSS_COLLECTION_DUPE' && (
                                            <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded">跨集合重复</span>
                                        )}
                                        {iss.type === 'DUPLICATE_PHANTOM' && (
                                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">幻影重复</span>
                                        )}
                                        {iss.type === 'RAPID_DUPLICATE' && (
                                            <span className="px-2 py-1 bg-pink-100 text-pink-700 text-xs rounded">连击重复</span>
                                        )}
                                        {iss.type === 'OFFSET_ERROR' && (
                                            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded">时区偏移</span>
                                        )}
                                        {(iss.type === 'LEGACY_FORMAT' || iss.type === 'DIRTY_DATA') && (
                                            <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded">脏数据/旧格式</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!scanning && scanStats.txCount > 0 && issues.length === 0 && (
                        <div className="mt-4 flex items-center text-green-600">
                            <CheckCircle2 className="mr-2 h-5 w-5" />
                            全域扫描完成，数据非常健康 (所有记录符合 New Schema 且无冲突)。
                        </div>
                    )}

                    {message && (
                        <p className="mt-2 font-medium text-sm">{message}</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
