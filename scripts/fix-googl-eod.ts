
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function main() {
    console.log("=== FIX GOOGL EOD ===");

    // Target: GOOGL Sep 18 2026 Call 150
    const shortSymbol = 'GOOGL260918C150';
    const occSymbol = 'GOOGL260918C00150000'; // OCC Format
    const targetDate = '2026-02-04';

    let yf: any;
    try {
        const pkg = require('yahoo-finance2');
        if (typeof pkg.default === 'function') {
            yf = new pkg.default();
        } else if (typeof pkg === 'function') {
            yf = new pkg(); // Class constructor
        } else {
            // Fallback or old version
            yf = pkg.default || pkg;
        }
    } catch (e) {
        console.error("No yahoo-finance2", e);
        return;
    }

    try {
        console.log(`Fetching Yahoo: ${occSymbol} for ${targetDate}`);
        const result = await yf.historical(occSymbol, {
            period1: '2026-02-01',
            period2: '2026-02-06'
        });

        console.log("Yahoo Result Valid?", Array.isArray(result));
        if (Array.isArray(result)) {
            result.forEach(r => console.log(`  ${formatDate(r.date)}: $${r.close}`));

            const match = result.find(r => formatDate(r.date) === targetDate);
            if (match) {
                console.log(`MATCH FOUND: ${match.close}`);
                const docId = `${targetDate}_${shortSymbol}`;
                await db.collection('officialCloses').doc(docId).set({
                    symbol: shortSymbol,
                    date: targetDate,
                    tradingDate: targetDate,
                    close: match.close,
                    currency: 'USD',
                    provider: 'fix_script',
                    source: 'official',
                    status: 'ok',
                    tz: 'America/New_York',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`Successful Write: ${docId}`);
            } else {
                console.log("NO MATCH for exact date.");
            }
        }

    } catch (e: any) {
        console.error("Yahoo Error", e.message);
    }
}

main();
