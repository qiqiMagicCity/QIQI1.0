
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        console.error("Firebase failing initialization.");
        process.exit(1);
    }
}

const db = getFirestore();

// --- Helpers ---
function toNyDate(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function getPath(obj: any, path: string) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function pickFirst<T = any>(obj: any, keys: string[]): T | undefined {
    for (const k of keys) {
        const v = k.includes('.') ? getPath(obj, k) : obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v as T;
    }
    return undefined;
}

function normalizeFireTx(raw: any) {
    const symbolRaw = pickFirst<string>(raw, ['symbol', 'ticker', 'underlying', 'symbolRoot', 'optionDetails.symbol']);
    let symbol = symbolRaw != null ? String(symbolRaw).trim().toUpperCase() : '';

    // Simple logic to detect options vs stocks and normalize symbol
    const atCand = (pickFirst<any>(raw, ['assetType', 'securityType', 'instrumentType']) ?? '').toString().toLowerCase();
    const isOption = atCand.includes('option') || (raw.type && raw.type.toLowerCase().includes('option'));

    // For this audit, we care about the SYMBOL that needs EOD data.
    // If it's an option 'AAPL 250101C...', the underlying is AAPL.
    // BUT the system might store option price history? unlikely.
    // Usually EOD gap audit is for STOCKS.
    // EodAutoManager excludes options.
    // So we should EXTRACT ROOT SYMBOL if it's an option, or just focus on AssetType=stock.
    // The prompt says "Current Holdings". If I hold an option, do I need EOD for the option?
    // User conversation "Exclude Options from EOD" says NO.
    // So we ONLY care about AssetType = Stock.

    if (isOption) return null; // Skip options

    return { symbol, qty: Number(raw.qty || 0) };
}

async function getActiveSymbols(): Promise<Set<string>> {
    console.log("Scanning users for active stock holdings...");
    const usersSnap = await db.collection('users').get();
    const headers = new Set<string>();

    for (const doc of usersSnap.docs) {
        const uid = doc.id;
        const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
        const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();

        const allDocs = [...txSnap.docs, ...tradeSnap.docs];

        // Simple aggregation
        const qtyMap = new Map<string, number>();

        allDocs.forEach(d => {
            const data = d.data();
            const res = normalizeFireTx(data);
            if (res) {
                const s = res.symbol;
                const c = qtyMap.get(s) || 0;
                qtyMap.set(s, c + res.qty);
            }
        });

        // Add to headers if net qty != 0 (approximation of holding)
        // Or should we audit EVERYTHING that has ever been traded?
        // Prompt says: "Current Holdings".
        for (const [sym, qty] of qtyMap.entries()) {
            if (Math.abs(qty) > 0.0001) {
                headers.add(sym);
            }
        }
    }
    return headers;
}

async function checkSymbolStatus(symbol: string, todayNy: string) {
    // Strategy: 
    // 1. Try Query 'officialCloses' by symbol (requires index).
    // 2. If fail, Probe recent dates by ID using get().

    let latestDate: string | null = null;

    try {
        const q = db.collection('officialCloses')
            .where('symbol', '==', symbol)
            .orderBy('tradingDate', 'desc')
            .limit(1);

        const snap = await q.get();
        if (!snap.empty) {
            const d = snap.docs[0].data();
            latestDate = d.tradingDate || d.date; // Support legacy field
        } else {
            // Empty sorted result -> No data at all?
            // Or maybe index missing? If index missing, it throws.
        }
    } catch (e: any) {
        // likely index missing
        // Fallback to ID Probe for last 10 days
        // console.log(`[Warn] Index missing for ${symbol}, probing by ID...`);

        const probeDays = 15;
        const now = new Date(); // should interpret as NY time... simplified:
        // iterate back

        // We need a helper to iterate dates back from todayNy
        // Assuming todayNy is "YYYY-MM-DD"

        let curr = new Date(todayNy);
        for (let i = 0; i < probeDays; i++) {
            const dStr = curr.toISOString().split('T')[0];
            const id = `${dStr}_${symbol}`;
            const docSnap = await db.collection('officialCloses').doc(id).get();
            if (docSnap.exists) {
                latestDate = dStr;
                break;
            }
            curr.setDate(curr.getDate() - 1);
        }
    }

    if (!latestDate) {
        // Final check: 'stockDetails' might have info? 
        // nah, treat as MISSING.
        return { status: 'MISSING', date: null, gap: 999 };
    }

    // Calc Gap
    const dLatest = new Date(latestDate);
    const dToday = new Date(todayNy);
    const diffTime = dToday.getTime() - dLatest.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Logic: > 3 days = OUTDATED
    if (diffDays > 3) { // 3 days allows for weekend (Friday to Monday is 3 days: Fri, Sat, Sun, Mon.. wait. Fri->Mon is 3 days diff. Sat(1), Sun(2), Mon(3). So > 3 means 4+ days.)
        // Actually, if today is Monday (1st), latest Friday (29th?). 
        // 1st - 29th (Jan) = 31 - 29 + 1 = 3 days. 
        // So <= 3 is healthy for weekend.
        return { status: 'OUTDATED', date: latestDate, gap: diffDays };
    }

    return { status: 'HEALTHY', date: latestDate, gap: diffDays };
}

async function main() {
    const today = new Date();
    const todayNy = toNyDate(today);
    console.log(`[Audit] Audit Date (NY): ${todayNy}`);

    const symbols = await getActiveSymbols();
    const sortedSymbols = Array.from(symbols).sort();
    console.log(`[Audit] Found ${sortedSymbols.length} unique active stock holdings.`);

    let missingCount = 0;
    let outdatedCount = 0;
    let healthyCount = 0;

    console.log(`\n[审计报告]`);
    console.log(`--------------------------------------------------`);

    for (const sym of sortedSymbols) {
        const res = await checkSymbolStatus(sym, todayNy);

        if (res.status === 'MISSING') {
            console.log(`🔴 ${sym.padEnd(6)}: 完全无数据`);
            missingCount++;
        } else if (res.status === 'OUTDATED') {
            console.log(`🟡 ${sym.padEnd(6)}: 数据停滞于 ${res.date} (已过期 ${res.gap} 天)`);
            outdatedCount++;
        } else {
            console.log(`🟢 ${sym.padEnd(6)}: 正常 (${res.date})`);
            healthyCount++;
        }
    }

    console.log(`--------------------------------------------------`);
    console.log(`总结: 需补录 ${missingCount} 个，需更新 ${outdatedCount} 个，正常 ${healthyCount} 个。`);
    console.log(`总计: ${sortedSymbols.length}`);
}

main().catch(console.error);
