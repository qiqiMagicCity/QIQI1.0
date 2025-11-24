
const admin = require('firebase-admin');
const serviceAccount = require('C:\\Users\\QiQi_\\.gemini\\service_account_key.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function debugEod() {
    console.log('--- Debugging EOD ---');

    // 1. Check Date
    const nyDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    console.log(`NY Date: ${nyDate}`);

    // 2. Check Holidays
    const holidaysRef = db.collection('meta').doc('marketHolidays');
    const holidaysSnap = await holidaysRef.get();
    if (holidaysSnap.exists) {
        const data = holidaysSnap.data();
        console.log('Holidays found:', JSON.stringify(data));
        const list = data.list || data.holidays || [];
        if (list.includes(nyDate)) {
            console.error(`CRITICAL: ${nyDate} is marked as a holiday!`);
        } else {
            console.log(`${nyDate} is NOT a holiday.`);
        }
    } else {
        console.log('meta/marketHolidays does not exist.');
    }

    // 3. Check EOD Symbols
    const symbolsRef = db.collection('meta').doc('eodSymbols');
    const symbolsSnap = await symbolsRef.get();
    let symbols = [];
    if (symbolsSnap.exists) {
        const data = symbolsSnap.data();
        symbols = data.list || [];
        console.log(`Found ${symbols.length} EOD symbols.`);
        if (symbols.length > 0) {
            console.log('Sample symbols:', symbols.slice(0, 5));
        } else {
            console.error('CRITICAL: EOD symbol list is empty!');
        }
    } else {
        console.error('CRITICAL: meta/eodSymbols does not exist!');
    }

    // 4. Check Stock Details for a sample symbol
    if (symbols.length > 0) {
        const sampleSym = symbols[0];
        console.log(`Checking stockDetails for ${sampleSym}...`);
        const stockRef = db.collection('stockDetails').doc(sampleSym);
        const stockSnap = await stockRef.get();
        if (stockSnap.exists) {
            const data = stockSnap.data();
            console.log('Stock Data:', {
                symbol: data.symbol,
                last: data.last,
                updatedAt: data.updatedAt ? new Date(data.updatedAt.toDate()).toISOString() : 'N/A'
            });
            if (typeof data.last !== 'number') {
                console.error(`CRITICAL: ${sampleSym} has no valid 'last' price!`);
            }
        } else {
            console.error(`CRITICAL: stockDetails/${sampleSym} does not exist!`);
        }

        // 5. Check if EOD doc exists
        const eodId = `${nyDate}_${sampleSym}`;
        const eodRef = db.collection('officialCloses').doc(eodId);
        const eodSnap = await eodRef.get();
        if (eodSnap.exists) {
            console.log(`EOD doc ${eodId} EXISTS. Status:`, eodSnap.data().status);
        } else {
            console.log(`EOD doc ${eodId} does NOT exist.`);
        }
    }
}

debugEod().catch(console.error);
