
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// 1. Initialize Firebase
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        // Fallback or ignore if already init
        if (!admin.apps.length) admin.initializeApp();
    }
}

const db = getFirestore();

// Helper
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

interface AuditItem {
    symbol: string;
    assetType: string;
}

async function main() {
    console.log("=== 审计修正：纯正股 (Stock-Only) 历史数据缺口扫描 ===\n");

    // 1. 严格筛选 (Strict Filter)
    const usersSnap = await db.collection('users').get();
    console.log(`Debug: Found ${usersSnap.docs.length} users.`);

    const stockSymbols = new Set<string>();
    const unknownAssetTypes = new Set<string>();

    for (const doc of usersSnap.docs) {
        const uid = doc.id;
        // Scan transitions and trades
        const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
        const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();
        const allDocs = [...txSnap.docs, ...tradeSnap.docs];

        if (allDocs.length > 0) {
            console.log(` Scanning User ${uid}: ${allDocs.length} records...`);
        }

        for (const record of allDocs) {
            const data = record.data();

            // Core Filter: assetType == 'stock' (case insensitive)
            const atCand = (pickFirst<any>(data, ['assetType', 'securityType', 'instrumentType']) ?? '').toString();
            const assetTypeLower = atCand.toLowerCase().trim();

            if (!assetTypeLower) {
                unknownAssetTypes.add(`(empty/undefined) in doc ${record.id}`);
                continue;
            }

            if (assetTypeLower !== 'stock') {
                if (assetTypeLower !== 'option' && assetTypeLower !== 'crypto' && assetTypeLower !== 'future') {
                    // Only log interesting unknowns, ignore standard non-stocks to reduce noise if needed, 
                    // but user asked to log warnings.
                    unknownAssetTypes.add(`${atCand} (doc ${record.id})`);
                }
                continue;
            }

            // It IS a stock
            const symbolRaw = pickFirst<string>(data, ['symbol', 'ticker', 'underlying']);
            if (symbolRaw) {
                const sym = String(symbolRaw).trim().toUpperCase();
                stockSymbols.add(sym);
            }
        }
    }

    if (unknownAssetTypes.size > 0) {
        console.log("\n[WARNING] Found unknown assetTypes:");
        // Limit output
        Array.from(unknownAssetTypes).slice(0, 10).forEach(t => console.log(` - ${t}`));
        if (unknownAssetTypes.size > 10) console.log(` ... and ${unknownAssetTypes.size - 10} more.`);
    }

    // 2. 提取标的 (Extract Symbols)
    const sortedSymbols = Array.from(stockSymbols).sort();
    console.log(`\n\n>> 提取到 ${sortedSymbols.length} 个正股标的 (Stock Only)。`);

    if (sortedSymbols.length === 0) {
        console.log("🔴 未找到任何 assetType='stock' 的记录！请检查数据库字段。");
        return;
    }

    // 3. 核对库存 (Check EOD) & 4. 输出结果
    console.log("\n正在核对 EOD 数据库存...\n");

    console.log(`| ${"Symbol".padEnd(8)} | ${"Count".padEnd(8)} | ${"Status".padEnd(10)} | ${"Action".padEnd(20)} |`);
    console.log(`|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(12)}|${"-".repeat(22)}|`);

    for (const sym of sortedSymbols) {
        const historySnap = await db.collection('stocks').doc(sym).collection('history').count().get();
        const count = historySnap.data().count;

        let status = "🟢 OK";
        let action = "";

        if (count < 10) {
            status = "🔴 MISSING";
            action = "需上传 txt / Backfill";
        }

        console.log(`| ${sym.padEnd(8)} | ${String(count).padEnd(8)} | ${status.padEnd(10)} | ${action.padEnd(20)} |`);
    }

    console.log("\n=== 扫描完成 ===");
}

main().catch(console.error);
