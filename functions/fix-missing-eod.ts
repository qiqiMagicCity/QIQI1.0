
import * as admin from 'firebase-admin';
import { fetchAndSaveOfficialClose } from './src/lib/close/run';

// Initialize Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

const tasks = [
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
    console.log("Start Backfill...");
    const secrets = {
        FMP_TOKEN: "",
        MARKETSTACK_API_KEY: "",
        STOCKDATA_API_KEY: ""
    };

    for (const task of tasks) {
        console.log(`Processing ${task.date}...`);
        for (const symbol of task.symbols) {
            try {
                // Add delay to be nice
                await new Promise(r => setTimeout(r, 500));
                const res = await fetchAndSaveOfficialClose(db, symbol, task.date, secrets);
                console.log(`[${task.date}] ${symbol}: ${res.status} ${res.close ?? ''}`);
            } catch (e: any) {
                console.error(`[${task.date}] ${symbol} ERROR:`, e.message);
            }
        }
    }
}

run();
