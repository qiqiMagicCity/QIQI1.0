import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { initializeFirebaseAdmin } from '@/lib/firebase-admin';

// Initialize Admin SDK
initializeFirebaseAdmin();

// [SECURITY] Hardcoded Admin Emails matching provider.tsx/firestore.rules
const ADMIN_EMAILS = [
    'qiqi_MagicCity@outlook.com',
    // 'replace_with_your_admin_email@example.com' 
];

export async function GET(request: Request) {
    try {
        // 1. Verify Authentication Header
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const idToken = authHeader.split('Bearer ')[1];

        // 2. Verify ID Token
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        // 3. Admin Check (Email-based)
        if (!decodedToken.email || !ADMIN_EMAILS.includes(decodedToken.email)) {
            // Also check custom claims just in case
            if (decodedToken.admin !== true) {
                return NextResponse.json({ error: 'Forbidden: Not an Admin' }, { status: 403 });
            }
        }

        // 4. List Users (Limit 1000 for simplicity)
        // Note: Local dev might need explicit credentials if this fails.
        const listUsersResult = await admin.auth().listUsers(1000);

        const users = listUsersResult.users.map(u => ({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
            lastSignInTime: u.metadata.lastSignInTime,
            creationTime: u.metadata.creationTime,
        }));

        return NextResponse.json({ users });

    } catch (error: any) {
        console.error('API /admin/users Error:', error);
        return NextResponse.json({
            error: error.message || 'Internal Server Error',
            hint: 'If running locally, ensure GOOGLE_APPLICATION_CREDENTIALS is set or firebase logging is active.'
        }, { status: 500 });
    }
}
