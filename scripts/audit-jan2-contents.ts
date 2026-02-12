
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, limit } from 'firebase/firestore';

const firebaseConfig = {
    "projectId": "studio-9804216494-c2b75",
    "appId": "1:7191046993:web:1bfb1315c72e7ee0bd4170",
    "apiKey": "AIzaSyDTT1tko3a_QqyZUm_BBERWM6fO2S8iLUE",
    "authDomain": "studio-9804216494-c2b75.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function runAudit() {
    console.log('--- [Audit] Listing Official Closes for 2026-01-02 ---');
    const q = query(
        collection(db, 'officialCloses'),
        where('tradingDate', '==', '2026-01-02'),
        limit(20)
    );

    try {
        const snap = await getDocs(q);
        console.log(`Found ${snap.size} documents for 2026-01-02`);
        snap.forEach(d => {
            console.log(` - ID: ${d.id} | Symbol: ${d.data().symbol} | Status: ${d.data().status} | Close: ${d.data().close}`);
        });
    } catch (err: any) {
        console.error('Error listing closes:', err.code, err.message);
    }

    console.log('\n--- [Audit] Specific symbols check ---');
    const specific = [
        '2026-01-02_AAPL',
        '2026-01-02_NVDA',
        '2026-01-02_MSFT',
        '2026-01-02_NKE260109C65'
    ];
    for (const id of specific) {
        const snap = await getDocs(query(collection(db, 'officialCloses'), where('__name__', '==', id)));
        if (!snap.empty) {
            console.log(` - [${id}] EXISTS (via query)`);
        } else {
            console.log(` - [${id}] NOT FOUND (via query)`);
        }
    }
}

runAudit();
