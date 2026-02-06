
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
    console.log("=== FIX NVO EOD (Manual Fetch) ===");

    // Target: NVO for 2026-02-04
    const symbol = 'NVO';
    const targetDate = '2026-02-04';

    let yf: any;
    try {
        const pkg = require('yahoo-finance2');
        if (typeof pkg.default === 'function') {
            yf = new pkg.default();
        } else if (typeof pkg === 'function') {
            yf = new pkg();
        } else {
            yf = pkg.default || pkg;
        }
    } catch (e) {
        console.error("No yahoo-finance2", e);
        return;
    }

    try {
        console.log(`Fetching Yahoo: ${symbol} for ${targetDate}`);
        // Yahoo historical range needs to surround the date
        const result = await yf.historical(symbol, {
            period1: '2026-02-01',
            period2: '2026-02-06'
        });

        if (Array.isArray(result)) {
            const match = result.find(r => formatDate(r.date) === targetDate);
            if (match) {
                console.log(`MATCH FOUND: ${match.close}`);
                const docId = `${targetDate}_${symbol}`;
                await db.collection('officialCloses').doc(docId).set({
                    symbol: symbol,
                    date: targetDate,
                    tradingDate: targetDate,
                    close: match.close,
                    currency: 'USD',
                    provider: 'fix_script_manual',
                    source: 'official',
                    status: 'ok',
                    tz: 'America/New_York',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`Successful Write: ${docId}`);
            } else {
                console.log("NO MATCH for exact date. Available dates:", result.map(r => formatDate(r.date)));
            }
        } else {
            console.log("Yahoo returned invalid result:", result);
        }

    } catch (e: any) {
        console.error("Yahoo Error", e.message);
    }
}

main();
