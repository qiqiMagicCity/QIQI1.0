
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        admin.initializeApp();
        console.log('Firebase Admin initialized.');
    } catch (e) {
        console.error('Failed to initialize Firebase Admin:', e);
        process.exit(1);
    }
}

const db = getFirestore();

async function debugHoldings(symbol: string) {
    console.log(`Debugging holdings for symbol: ${symbol}`);

    const transactionsRef = db.collection('transactions');
    const snapshot = await transactionsRef.where('symbol', '==', symbol).get();

    if (snapshot.empty) {
        console.log(`No transactions found for ${symbol}`);
        return;
    }

    console.log(`Found ${snapshot.size} transactions for ${symbol}:`);

    let totalQty = 0;
    const transactions = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate() || new Date(data.date) // Handle timestamp or date string
        };
    });

    // Sort by date
    transactions.sort((a: any, b: any) => a.timestamp - b.timestamp);

    transactions.forEach((tx: any) => {
        console.log(`  ${tx.date} ${tx.type} ${tx.qty} @ ${tx.price}`);
        totalQty += tx.qty;
    });

    console.log(`Total calculated quantity for ${symbol}: ${totalQty}`);
}

const symbol = process.argv[2];
if (!symbol) {
    console.error('Please provide a symbol as an argument.');
    process.exit(1);
}

debugHoldings(symbol.toUpperCase()).catch(console.error);
