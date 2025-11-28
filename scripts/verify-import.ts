
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

const db = getFirestore();

async function verify() {
    console.log('Verifying import...');

    // Check GGLL for a specific date
    // 2: GGLL.US,D,20220909,000000,26.365,26.46,26.35,26.35,1065,0
    const ggllId = '2022-09-09_GGLL';
    const ggllDoc = await db.collection('officialCloses').doc(ggllId).get();
    if (ggllDoc.exists) {
        console.log(`✅ GGLL [${ggllId}] found:`, ggllDoc.data());
    } else {
        console.error(`❌ GGLL [${ggllId}] NOT found.`);
    }

    // Check OKLO for a specific date
    // 2: OKLO.US,D,20210708,000000,10,10.04,9.97,9.98,15054506,0
    const okloId = '2021-07-08_OKLO';
    const okloDoc = await db.collection('officialCloses').doc(okloId).get();
    if (okloDoc.exists) {
        console.log(`✅ OKLO [${okloId}] found:`, okloDoc.data());
    } else {
        console.error(`❌ OKLO [${okloId}] NOT found.`);
    }
}

verify().catch(console.error);
