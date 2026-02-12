
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

const checklist = [
    { date: '2026-01-02', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-05', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    { date: '2026-01-06', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50', 'NKE260109C65'] },
    // Sample check middle and end
    { date: '2026-01-15', symbols: ['GOOGL260918C150', 'NIO260618P3.5'] },
    { date: '2026-01-30', symbols: ['GOOGL260918C150', 'NIO260618P3.5', 'NVO261218C50'] },
];

async function check() {
    console.log("=== Checking DB Status After Backfill ===");
    for (const task of checklist) {
        for (const sym of task.symbols) {
            // Need to convert sym if it was stored differently? 
            // The previous script used the input symbol. The fetch logic might have normalized it.
            // Let's check the doc ID strictly.
            // Logic in fetchAndSaveOfficialClose: upperSymbol = symbol.toUpperCase().trim()
            // fetchSymbol = convertShortOptionToOcc(upperSymbol)
            // But the DOC ID is `${tradingDate}_${upperSymbol}` (Original Symbol)
            // UNLESS convertShortOptionToOcc changes it? 
            // Re-reading fetchAndSaveOfficialClose ts:64: docId = `${tradingDate}_${upperSymbol}`;
            // So the Doc ID uses the SHORT symbol if that's what was passed.

            const id = `${task.date}_${sym}`;
            const doc = await db.collection('officialCloses').doc(id).get();
            if (doc.exists) {
                const data = doc.data();
                console.log(`[${task.date}] ${sym}: ${data.status} (Close: ${data.close})`);
            } else {
                console.log(`[${task.date}] ${sym}: MISSING (Doc not found)`);
            }
        }
    }
}

check();
