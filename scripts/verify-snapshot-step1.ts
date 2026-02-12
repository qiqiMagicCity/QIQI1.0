
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

async function computeHash(message: string): Promise<string> {
    return crypto.createHash('sha256').update(message).digest('hex');
}

async function verifyStep1(providedUid: string) {
    let uid = providedUid;
    const userRes = await db.collection('users').limit(1).get();
    if (!userRes.empty) {
        uid = userRes.docs[0].id;
    }
    console.log(`=== VERIFY SNAPSHOT STEP 1: START (UID: ${uid}) ===`);

    const userRef = db.collection('users').doc(uid);
    const userSnapBefore = await userRef.get();
    const revBefore = userSnapBefore.data()?.txRevision || 0;
    console.log(`[User] txRevision before: ${revBefore}`);

    // Ensure doc exists for update
    if (!userSnapBefore.exists) {
        await userRef.set({ txRevision: 0 }, { merge: true });
    }

    // 1. Simulate a transaction write
    console.log("Simulating a transaction write with batch increment...");
    const batch = db.batch();
    const txId = `test_tx_${uuidv4()}`;
    batch.set(userRef.collection('transactions').doc(txId), {
        symbol: 'AAPL',
        price: 150,
        quantity: 10,
        transactionTimestamp: Date.now(),
        transactionDateNy: '2026-02-09',
        type: 'BUY'
    });
    batch.update(userRef, {
        txRevision: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();

    const userSnapAfter = await userRef.get();
    const revAfter = userSnapAfter.data()?.txRevision || 0;
    console.log(`[User] txRevision after: ${revAfter}`);

    if (revAfter === revBefore + 1) {
        console.log("✅ Success: txRevision incremented correctly.");
    } else {
        console.error("❌ Error: txRevision did not increment as expected.");
    }

    // 2. Test Fingerprint Calculation
    console.log("\nTesting Fingerprint Calculation...");
    const symbols = ['AAPL', 'MSFT', 'NVDA'];
    const revisions = [
        { symbol: 'AAPL', eodRevision: 5 },
        { symbol: 'MSFT', eodRevision: 12 },
        { symbol: 'NVDA', eodRevision: 3 }
    ];

    // Sort by symbol lexicographically
    const sorted = [...revisions].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const rawString = sorted.map(r => `${r.symbol}:${r.eodRevision}`).join('|');
    console.log(`- Raw String: "${rawString}"`);

    const fingerprint = await computeHash(rawString);
    console.log(`- Fingerprint (SHA-256): ${fingerprint}`);

    // 3. Write a dummy snapshot
    console.log("\nWriting a dummy snapshot to pnlSnapshots...");
    const monthId = "2026-02";
    const snapRef = db.collection('pnlSnapshots').doc(uid).collection('months').doc(monthId);

    const snapshotData = {
        monthId,
        fingerprint: {
            txRevision: revAfter,
            eodFingerprint: fingerprint,
            calcEngineVersion: '4.1.0-MVP',
            splitsRevision: '1',
            fxRevision: '1'
        },
        data: {
            totalPnl: 1234.56
        },
        meta: {
            symbols,
            computedAt: admin.firestore.FieldValue.serverTimestamp()
        }
    };

    await snapRef.set(snapshotData);
    console.log(`✅ Success: Snapshot ${monthId} written to Firestore.`);

    // Cleanup
    console.log("\nCleaning up test transaction...");
    await userRef.collection('transactions').doc(txId).delete();
    console.log("=== VERIFY SNAPSHOT STEP 1: END ===");
}

// Replace with a real UID if needed for more accurate testing, or use 'test_user_001'
const testUid = "L8h41hI6x5d7mAn4vAnUj1mRElB3"; // Use the one from the logs if possible
verifyStep1(testUid).catch(console.error);
