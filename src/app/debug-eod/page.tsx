'use client';

import { useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useFirestore, useUser } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { toNyCalendarDayString } from '@/lib/ny-time';

export default function DebugEodPage() {
    const firestore = useFirestore();
    const { user } = useUser();
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const log = (msg: string) => setLogs(prev => [...prev, msg]);

    const runDebug = async () => {
        if (!user) {
            log('Please login first.');
            return;
        }
        setLoading(true);
        setLogs([]);
        log('Starting EOD Debug...');

        try {
            // 1. Check Date
            const nyDate = toNyCalendarDayString(Date.now());
            log(`NY Date: ${nyDate}`);

            // 2. Check Holidays (Try-Catch)
            log('Checking meta/marketHolidays...');
            try {
                const holidaysRef = doc(firestore, 'meta', 'marketHolidays');
                const holidaysSnap = await getDoc(holidaysRef);
                if (holidaysSnap.exists()) {
                    const data = holidaysSnap.data();
                    const list = data.list || data.holidays || [];
                    log(`Holidays found: ${JSON.stringify(list)}`);
                    if (list.includes(nyDate)) {
                        log(`❌ CRITICAL: ${nyDate} is marked as a holiday!`);
                    } else {
                        log(`✅ ${nyDate} is NOT a holiday.`);
                    }
                } else {
                    log('⚠️ meta/marketHolidays does not exist (or permission denied).');
                }
            } catch (e: any) {
                log(`⚠️ Could not read marketHolidays: ${e.message}`);
            }

            // 3. Check EOD Symbols (Try-Catch)
            log('Checking meta/eodSymbols...');
            let symbols: string[] = [];
            try {
                const symbolsRef = doc(firestore, 'meta', 'eodSymbols');
                const symbolsSnap = await getDoc(symbolsRef);
                if (symbolsSnap.exists()) {
                    const data = symbolsSnap.data();
                    symbols = data.list || [];
                    log(`✅ Found ${symbols.length} EOD symbols from meta.`);
                } else {
                    log('⚠️ meta/eodSymbols does not exist (or permission denied).');
                }
            } catch (e: any) {
                log(`⚠️ Could not read eodSymbols: ${e.message}`);
            }

            // Fallback symbols if meta failed
            if (symbols.length === 0) {
                log('⚠️ Using fallback symbols for check: AAPL, TSLA, NVDA, SPY, QQQ');
                symbols = ['AAPL', 'TSLA', 'NVDA', 'SPY', 'QQQ'];
            }

            // 4. Check Stock Details & Official Closes for first 5 symbols
            if (symbols.length > 0) {
                const sampleSymbols = symbols.slice(0, 5);
                log(`Checking details for samples: ${sampleSymbols.join(', ')}`);

                for (const sym of sampleSymbols) {
                    // Stock Details
                    try {
                        const stockRef = doc(firestore, 'stockDetails', sym);
                        const stockSnap = await getDoc(stockRef);
                        if (stockSnap.exists()) {
                            const data = stockSnap.data();
                            log(`Stock [${sym}]: Last=${data.last}, UpdatedAt=${data.updatedAt?.toDate?.()?.toISOString()}`);
                            if (typeof data.last !== 'number') {
                                log(`❌ [${sym}] Invalid 'last' price.`);
                            }
                        } else {
                            log(`❌ [${sym}] stockDetails missing.`);
                        }
                    } catch (e: any) {
                        log(`❌ [${sym}] Failed to read stockDetails: ${e.message}`);
                    }

                    // Official Close
                    try {
                        const eodId = `${nyDate}_${sym}`;
                        const eodRef = doc(firestore, 'officialCloses', eodId);
                        const eodSnap = await getDoc(eodRef);
                        if (eodSnap.exists()) {
                            log(`✅ EOD [${eodId}] EXISTS. Status: ${eodSnap.data().status}`);
                        } else {
                            log(`❌ EOD [${eodId}] MISSING.`);
                        }
                    } catch (e: any) {
                        log(`❌ [${sym}] Failed to read officialCloses: ${e.message}`);
                    }
                }
            }

        } catch (err: any) {
            log(`Error: ${err.message}`);
            console.error(err);
        } finally {
            setLoading(false);
            log('Debug finished.');
        }
    };

    return (
        <div className="p-8">
            <Card>
                <CardHeader>
                    <CardTitle>EOD Debugger</CardTitle>
                </CardHeader>
                <CardContent>
                    <button
                        onClick={runDebug}
                        disabled={loading}
                        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                    >
                        {loading ? 'Running...' : 'Run Debug'}
                    </button>
                    <pre className="mt-4 bg-slate-100 p-4 rounded text-xs font-mono whitespace-pre-wrap h-[500px] overflow-auto">
                        {logs.join('\n')}
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
}
