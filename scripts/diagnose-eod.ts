
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { toNyCalendarDayString, prevNyTradingDayString } from '../src/lib/ny-time';

// Initialize Firebase (assumes default credentials or configured env)
try { initializeApp(); } catch (e) {}
const db = getFirestore();

async function diagnose() {
  console.log('=== EOD Diagnosis ===');
  
  // 1. Determine Target Date (Previous Trading Day)
  const today = toNyCalendarDayString(new Date());
  const prevTradingDay = prevNyTradingDayString(today);
  console.log(`Today (NY): ${today}`);
  console.log(`Target EOD Date (Prev Trading Day): ${prevTradingDay}`);

  // 2. Check meta/eodSymbols
  console.log('\n--- Checking Monitored Symbols (meta/eodSymbols) ---');
  const metaDoc = await db.collection('meta').doc('eodSymbols').get();
  if (!metaDoc.exists) {
    console.warn('❌ meta/eodSymbols document does NOT exist!');
  } else {
    const list = metaDoc.data()?.list || [];
    console.log(`Found ${list.length} symbols in monitoring list.`);
    const samples = ['NVDA', 'AMZN', 'NFLX', 'GME', 'MSTR'];
    samples.forEach(sym => {
      const found = list.includes(sym);
      console.log(`Symbol ${sym}: ${found ? '✅ Monitored' : '❌ NOT Monitored'}`);
    });
  }

  // 3. Check officialCloses for Target Date
  console.log(`\n--- Checking Data for Date: ${prevTradingDay} ---`);
  const samples = ['NVDA', 'AMZN', 'NFLX', 'GME', 'MSTR'];
  for (const sym of samples) {
    const docId = `${prevTradingDay}_${sym}`;
    const docRef = db.collection('officialCloses').doc(docId);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
        const data = docSnap.data();
        console.log(`✅ ${sym}: Found. Price=${data?.price}, Source=${data?.source}`);
    } else {
        console.log(`❌ ${sym}: MISSING docId=${docId}`);
    }
  }

  console.log('\nDone.');
}

diagnose().catch(console.error);
