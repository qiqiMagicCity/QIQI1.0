
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

async function checkTradesCollection() {
    console.log('🔍 Checking `trades` collection for GOOGL transactions...');

    // Check global trades collection (if exists) - usually it's under users/{uid}/trades
    // Let's scan all users and check their 'trades' subcollection
    const userRefs = await db.collection('users').listDocuments();
    let foundCount = 0;

    for (const userRef of userRefs) {
        // Check `trades` subcollection (legacy/manual entry?)
        const tradesSnap = await userRef.collection('trades').get();

        tradesSnap.forEach(doc => {
            const data = doc.data();
            const symbol = data.symbol || data.ticker || '';
            const type = data.assetType || data.type || '';

            if (symbol.includes('GOOG') || symbol.includes('NVO') || symbol.includes('NIO') || symbol.includes('AAPL')) {
                // Check if it's an option-like thing
                if (type === 'option' || data.putCall || data.strike || (data.multiplier && data.multiplier === 100)) {
                    console.log('------------------------------------------------');
                    console.log(`User: ${userRef.id}`);
                    console.log(`Collection: trades`);
                    console.log(`Doc ID: ${doc.id}`);
                    console.log('Data:', JSON.stringify(data, null, 2));
                    foundCount++;
                }
            }
        });

        // Also check `transactions` subcollection again, just in case we missed it due to strict equality
        const txSnap = await userRef.collection('transactions').get();
        txSnap.forEach(doc => {
            const data = doc.data();
            const symbol = data.symbol || '';
            // Loose match
            if (symbol.includes('GOOG') || symbol.includes('260918')) {
                console.log('--- [Check Trans] ---');
                console.log(`Doc ID: ${doc.id}`);
                console.log('Data:', JSON.stringify(data, null, 2));
            }
        });
    }

    if (foundCount === 0) {
        console.log('❌ Still no option trades found in `trades` subcollections.');
    } else {
        console.log(`✅ Found ${foundCount} potential option trades.`);
    }
}

checkTradesCollection().catch(console.error);
