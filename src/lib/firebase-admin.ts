
import * as admin from 'firebase-admin';

export function initializeFirebaseAdmin() {
    if (!admin.apps.length) {
        try {
            admin.initializeApp();
            console.log('[Firebase Admin] Initialized.');
        } catch (error) {
            console.error('[Firebase Admin] Initialization failed:', error);
        }
    }
}
