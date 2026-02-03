
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

async function main() {
    console.log("Checking users count...");
    const snap = await db.collection('users').count().get();
    console.log(`Count result: ${snap.data().count}`);

    const snap2 = await db.collection('users').limit(1).get();
    console.log(`Limit 1 result: ${snap2.size}`);
    if (snap2.size > 0) {
        console.log(`Sample ID: ${snap2.docs[0].id}`);
    }
}
main();
