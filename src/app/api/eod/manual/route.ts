
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '@/lib/firebase-admin';

// Initialize Firebase Admin (Server-side)
initializeFirebaseAdmin();
export async function POST(request: Request) {
    try {
        // Initialize inside the handler to avoid module-level crashes
        initializeFirebaseAdmin();
        const db = getFirestore();

        const body = await request.json();
        const { symbol, date, price } = body;

        if (!symbol || !date || typeof price !== 'number') {
            return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
        }

        const eodId = `${date}_${symbol}`;
        const docRef = db.collection('officialCloses').doc(eodId);

        await docRef.set({
            symbol,
            date,
            tradingDate: date,
            close: price,
            status: 'ok',
            provider: 'manual_entry_api',
            updatedAt: new Date()
        }, { merge: true });

        return NextResponse.json({ message: 'Saved successfully', id: eodId });

    } catch (error: any) {
        console.error('[API] Manual EOD save failed:', error);
        // Return JSON even for system errors
        return NextResponse.json({
            message: 'Save failed',
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}
