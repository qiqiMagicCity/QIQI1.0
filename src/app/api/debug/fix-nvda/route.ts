
import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export async function GET() {
    try {
        let status = 'init';

        if (!admin.apps.length) {
            try {
                admin.initializeApp();
                status = 'initialized';
            } catch (e: any) {
                return NextResponse.json({ error: 'Init failed', details: e.message }, { status: 500 });
            }
        } else {
            status = 'already_initialized';
        }

        const db = getFirestore();

        // Try to read one doc to verify connection
        try {
            const testDoc = await db.collection('officialCloses').doc('2025-11-24_NVDA').get();
            return NextResponse.json({
                status: 'ok',
                firebaseStatus: status,
                docExists: testDoc.exists,
                data: testDoc.exists ? testDoc.data() : null
            });
        } catch (dbError: any) {
            return NextResponse.json({ error: 'DB Read failed', details: dbError.message }, { status: 500 });
        }

    } catch (error: any) {
        return NextResponse.json({ error: 'Unexpected error', stack: error.stack }, { status: 500 });
    }
}
