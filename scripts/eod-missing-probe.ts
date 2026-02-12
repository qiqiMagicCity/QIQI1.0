import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

// Use service account if available, or default
const serviceAccountPath = './service-account.json'; // Common location
let app;
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    app = initializeApp({
        credential: cert(serviceAccount),
        projectId: 'studio-9804216494-c2b75'
    });
} else {
    // Rely on ADC or environment
    app = initializeApp({
        projectId: 'studio-9804216494-c2b75'
    });
}

const db = getFirestore(app);

async function checkMissingDocs() {
    const testIds = [
        '2025-10-01_AMZN',
        '2025-10-02_AMZN',
        '2025-10-15_AMZN',
        '2025-10-30_AMZN',
        '2025-10-31_AMZN',
        '2025-10-01_AAPL',
        '2025-10-02_AAPL',
        '2025-10-15_AAPL',
        '2025-10-30_AAPL',
        '2025-10-31_AAPL'
    ];

    console.log(`--- 🔍 FIREBASE-ADMIN EOD PROBE (Project: studio-9804216494-c2b75) ---`);

    for (const id of testIds) {
        const docRef = db.collection('officialCloses').doc(id);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            const data = docSnap.data();
            console.log(`✅ [EXIST] ${id} | Close: ${data?.close} | Status: ${data?.status}`);
        } else {
            console.log(`❌ [NOT FOUND] ${id}`);
        }
    }
}

checkMissingDocs().catch(console.error);
