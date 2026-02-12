
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();

// Helper to get previous trading date (simplified, just goes back 1 day loop)
function getPreviousDate(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

// Strict Option Check
function isOptionSymbol(symbol: string): boolean {
    // Regex for:
    // 1. Standard OCC: 6 digits + C/P + 8 digits
    // 2. Short format: 6 digits + C/P + price
    // Simple check: Must contain 6 digits followed by C or P
    return /[0-9]{6}[CP]/.test(symbol);
}

const checklist = [
    { date: '2026-01-02', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-05', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-06', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-07', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-08', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-09', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-12', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-13', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-14', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-15', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-16', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-20', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-21', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-22', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-23', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-26', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65', 'GME260206P24'] },
    { date: '2026-01-27', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65', 'GME260206P24'] },
    { date: '2026-01-28', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65', 'GME260206P24'] },
    { date: '2026-01-29', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50'] },
    { date: '2026-01-30', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'ORCL260206C182.5', 'AAPL260206C270'] },
];

async function run() {
    console.log("=== STARTING STRICT GAP FILL (OPTIONS ONLY) ===");

    for (const task of checklist) {
        for (const symbol of task.symbols) {
            // [CRITICAL] Safety Check
            if (!isOptionSymbol(symbol)) {
                console.warn(`[SAFETY] Skipping Non-Option Symbol: ${symbol}`);
                continue;
            }

            const docId = `${task.date}_${symbol}`;
            const docRef = db.collection('officialCloses').doc(docId);
            const snap = await docRef.get();
            const data = snap.data();

            // Check if missing or error or missing_vendor
            if (!snap.exists || data?.status !== 'ok') {
                console.log(`[${task.date}] ${symbol} (Option) is Missing/Error (${data?.status ?? 'missing'}). Attempting Forward Fill...`);

                // Look backwards up to 30 days
                let prevDate = getPreviousDate(task.date);
                let foundClose = null;

                for (let i = 0; i < 30; i++) {
                    const prevId = `${prevDate}_${symbol}`;
                    const prevSnap = await db.collection('officialCloses').doc(prevId).get();
                    if (prevSnap.exists && prevSnap.data()?.status === 'ok') {
                        foundClose = prevSnap.data()?.close;
                        console.log(`   -> Found previous close on ${prevDate}: ${foundClose}`);
                        break;
                    }
                    prevDate = getPreviousDate(prevDate);
                }

                if (foundClose !== null) {
                    await docRef.set({
                        status: 'ok',
                        close: foundClose,
                        symbol: symbol,
                        date: task.date,
                        tradingDate: task.date,
                        provider: 'gap_fill_prev',
                        note: 'Strict forward fill (Option Only)',
                        retrievedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    console.log(`   -> FILLED ${task.date} with ${foundClose}`);
                } else {
                    console.log(`   -> FAILED: No previous history found within 30 days.`);
                }
            }
        }
    }
    console.log("=== DONE ===");
}

run();
