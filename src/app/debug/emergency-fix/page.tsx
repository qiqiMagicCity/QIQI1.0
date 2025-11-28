'use client';

import { useEffect, useState } from 'react';
import { initializeFirebase } from '@/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';

export default function EmergencyFixPage() {
    const [status, setStatus] = useState('Waiting for Auth...');
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        const { auth } = initializeFirebase();
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
                setUser(u);
                setStatus(`Authenticated as ${u.email}. Calling Cloud Function...`);
                fix(u);
            } else {
                setStatus('Not Authenticated. Please log in first.');
            }
        });
        return () => unsubscribe();
    }, []);

    const fix = async (u: any) => {
        try {
            const { firebaseApp } = initializeFirebase();
            const functions = getFunctions(firebaseApp, 'us-central1');
            const saveRealTimeEod = httpsCallable(functions, 'saveRealTimeEod');

            const symbol = 'NVDA';
            const date = '2025-11-24';
            const price = 182.55;

            // Call the Cloud Function
            const result = await saveRealTimeEod({
                symbol,
                date,
                price
            });

            console.log('CLOUD_FUNCTION_RESULT', result);
            setStatus('SUCCESS: Data Written via Cloud Function');
            console.log('EMERGENCY_FIX_SUCCESS');
        } catch (e: any) {
            setStatus(`ERROR: ${e.message}`);
            console.error('EMERGENCY_FIX_ERROR', e);
        }
    };

    return (
        <div className="p-10 bg-blue-50 min-h-screen">
            <h1 className="text-2xl font-bold mb-4">Emergency Data Fix (Cloud Function)</h1>
            <div className="p-4 bg-white rounded shadow border border-blue-200">
                <div className="font-mono text-lg">{status}</div>
                {!user && (
                    <div className="mt-4 text-red-600">
                        Please open this page in a browser where you are already logged in.
                    </div>
                )}
            </div>
        </div>
    );
}
