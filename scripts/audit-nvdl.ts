
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// 1. Initialize Firebase
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        console.error("Firebase failing initialization.");
        process.exit(1);
    }
}

const db = getFirestore();

function normalizeTx(raw: any) {
    const symbol = (raw.symbol || raw.ticker || '').toUpperCase().trim();
    const result = {
        id: raw.id,
        symbol,
        qty: Number(raw.qty || raw.quantity || 0),
        price: Number(raw.price || 0),
        timestamp: raw.transactionTimestamp || 0,
        date: new Date(raw.transactionTimestamp || 0).toISOString().slice(0, 10),
        side: raw.side || (raw.qty > 0 ? 'BUY' : 'SELL'),
        raw
    };

    // Fix signs
    if (result.side === 'BUY') result.qty = Math.abs(result.qty);
    if (result.side === 'SELL') result.qty = -Math.abs(result.qty);

    return result;
}

async function main() {
    console.log("=== NVDL Audit Script (Checking Duplicates) ===");
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const txSnap = await db.collection('users').doc(uid).collection('transactions').get();
        const tradeSnap = await db.collection('users').doc(uid).collection('trades').get();

        const allTxs: any[] = [];
        txSnap.docs.forEach(d => allTxs.push({ ...d.data(), id: d.id, _source: 'transactions' }));
        tradeSnap.docs.forEach(d => allTxs.push({ ...d.data(), id: d.id, _source: 'trades' }));

        let nvdlTxs = allTxs.map(normalizeTx).filter(t => t.symbol === 'NVDL');

        if (nvdlTxs.length === 0) continue;

        console.log(`\nUser: ${uid} | Found ${nvdlTxs.length} NVDL transactions`);
        nvdlTxs.sort((a, b) => a.timestamp - b.timestamp);

        let netQty = 0;
        const signatureCounts = new Map<string, any[]>();

        // 1. Build Signatures to find duplicates
        nvdlTxs.forEach(tx => {
            // Signature: Date + Side + Qty + Price
            // Using loose date to catch same-day duplicates even if timestamp differs slightly (though user said copy paste, so likely fully identical or close)
            const sig = `${tx.date}|${tx.side}|${Math.abs(tx.qty)}|${tx.price}`;
            if (!signatureCounts.has(sig)) signatureCounts.set(sig, []);
            signatureCounts.get(sig)!.push(tx);
        });

        const duplicates: string[] = [];
        for (const [sig, txs] of signatureCounts.entries()) {
            if (txs.length > 1) {
                duplicates.push(sig);
            }
        }

        console.log(`---------------------------------------------------------------------------------------`);
        console.log(`| Date       | ID (Last 6) | Side | Qty  | Price   | Net  | Dup? | Source`);
        console.log(`---------------------------------------------------------------------------------------`);

        nvdlTxs.forEach(tx => {
            netQty += tx.qty;
            const sig = `${tx.date}|${tx.side}|${Math.abs(tx.qty)}|${tx.price}`;
            const isDup = signatureCounts.get(sig)!.length > 1 ? 'YES' : '';
            const dupWarning = isDup ? `(x${signatureCounts.get(sig)!.length})` : '';

            console.log(
                `| ${tx.date} ` +
                `| ...${tx.id.slice(-6)} ` +
                `| ${tx.side.padEnd(4)} ` +
                `| ${String(tx.qty).padEnd(4)} ` +
                `| ${String(tx.price).padEnd(7)} ` +
                `| ${String(netQty).padEnd(4)} ` +
                `| ${isDup.padEnd(3)} ${dupWarning} ` +
                `| ${tx.raw._source}`
            );
        });
        console.log(`---------------------------------------------------------------------------------------`);
        console.log(`Final Net Qty: ${netQty}`);

        if (duplicates.length > 0) {
            console.log("\n[POTENTIAL DUPLICATES DETECTED]");
            duplicates.forEach(sig => {
                const txs = signatureCounts.get(sig)!;
                console.log(`  - Signature [${sig}] appears ${txs.length} times on ${txs[0].date}:`);
                txs.forEach((t: any) => console.log(`      ID: ${t.id} (${t.raw._source})`));
            });
            console.log("\nPlease check these dates against your brokerage statement.");
        } else {
            console.log("\nNo obvious ID/Price/Qty duplicates found. Checking for missing sells or splits?");
        }
    }
}

main().catch(console.error);
