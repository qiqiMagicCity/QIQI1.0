
// Mock nyLocalToUtcMillis for testing
function nyLocalToUtcMillis(dateNy: string, hour: number, minute: number): number {
    const [y, m, d] = dateNy.split('-').map((s) => parseInt(s, 10));
    const utcHour = hour + 5;
    return Date.UTC(y, m - 1, d, utcHour, minute, 0);
}

// Simulating the parseBulkText function based on the modifications
function parseBulkText(raw: string): any[] {
    const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const trades: any[] = [];
    let currentDate: string | null = null;
    let indexInDay = 0;
    let pendingOpt: any = null;

    for (const line of lines) {
        // PRIORITY 1: Single-Line Option SMS (Simulated)
        const singleLineOptRegex = /^\d+:\s+您的期[權权]訂[單单](Buy|Sell).*?\b([A-Z]+)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+([\d\.]+)\s+([PC]).*?已成交(\d+)\s*張.*?成交價為[\$]([\d\.]+)[。\s\t]+(\d{1,2}):(\d{2})(AM|PM|am|pm)?\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i;
        const slMatch = line.match(singleLineOptRegex);

        if (slMatch) {
            // ... (Simulation of option extraction logic)
            const sideStr = slMatch[1].toUpperCase();
            const undSymbol = slMatch[2].toUpperCase();
            const expMo = slMatch[3];
            const expDay = slMatch[4];
            const expYr = slMatch[5];
            const strikeStr = slMatch[6];
            const right = slMatch[7].toUpperCase();
            const fillQtyStr = slMatch[8];
            const priceStr = slMatch[9];
            const hhStr = slMatch[10];
            const mmStr = slMatch[11];
            const ampm = slMatch[12];
            const monthStr = slMatch[13];
            const dayStr = slMatch[14];
            const yearStr = slMatch[15];

            const side = sideStr === 'BUY' ? 'BUY' : 'SELL';
            const quantity = Number(fillQtyStr);
            const price = Number(priceStr);
            const shortYear = expYr.slice(-2);
            const strikeVal = parseFloat(strikeStr);
            const symbol = `${undSymbol} ${shortYear}${expMo}${expDay} ${right} ${strikeVal}`;

            let hh = parseInt(hhStr, 10);
            const mm = parseInt(mmStr, 10);
            if (ampm) {
                const s = ampm.toUpperCase();
                if (s === 'PM' && hh < 12) hh += 12;
                if (s === 'AM' && hh === 12) hh = 0;
            }

            let fullYear = parseInt(yearStr, 10);
            if (fullYear < 100) fullYear += 2000;
            const dateNy = `${fullYear}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`;
            const finalTimeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
            const tsMillis = nyLocalToUtcMillis(dateNy, hh, mm);

            trades.push({
                dateNy,
                time: finalTimeStr,
                symbol,
                side,
                quantity,
                price,
                transactionTimestamp: tsMillis,
                assetType: 'option',
                multiplier: 100
            });
            continue;
        }

        // PRIORITY 2: Traditional Chinese Stock SMS (e.g. MSTR) [NEW LOGIC]
        const tradStockRegex = /^\d+:\s+您的(買進|賣出)訂單.*?(\d+)股([A-Z]+)已成交(\d+)股，成交價為\$([\d\.]+)[。\s\t]+(\d{1,2}):(\d{2})(AM|PM|am|pm)?\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i;
        const stockMatch = line.match(tradStockRegex);

        if (stockMatch) {
            const sideStr = stockMatch[1]; // 買進 or 賣出
            // const orderQty = stockMatch[2];
            const symbolStr = stockMatch[3];
            const fillQtyStr = stockMatch[4];
            const priceStr = stockMatch[5];

            const hhStr = stockMatch[6];
            const mmStr = stockMatch[7];
            const ampm = stockMatch[8];
            const monthStr = stockMatch[9];
            const dayStr = stockMatch[10];
            const yearStr = stockMatch[11];

            const side = (sideStr === '買進') ? 'BUY' : 'SELL';
            const quantity = Number(fillQtyStr);
            const price = Number(priceStr);
            const symbol = symbolStr.toUpperCase();

            // 2. Process Timestamp (Same logic as Option)
            let hh = parseInt(hhStr, 10);
            const mm = parseInt(mmStr, 10);
            if (ampm) {
                const s = ampm.toUpperCase();
                if (s === 'PM' && hh < 12) hh += 12;
                if (s === 'AM' && hh === 12) hh = 0;
            }

            let fullYear = parseInt(yearStr, 10);
            if (fullYear < 100) fullYear += 2000;
            const dateNy = `${fullYear}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`;
            const finalTimeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
            const tsMillis = nyLocalToUtcMillis(dateNy, hh, mm);

            trades.push({
                dateNy,
                time: finalTimeStr,
                symbol,
                side,
                quantity,
                price,
                transactionTimestamp: tsMillis,
                assetType: 'stock',
                multiplier: 1
            });
            continue;
        }
    }
    return trades;
}

// Test Case
const input = `
91213265: 您的期權訂單Buy Open10張合約GME 02/06/2026 24.000 P已成交1張合約，成交價為$1.11。	15:17PM 01/26/26
91213265: 您的買進訂單111股MSTR已成交80股，成交價為$166.60。	12:57PM 01/23/26
`;

console.log("Input:\n", input);
const results = parseBulkText(input);
console.log("\nResults:\n", JSON.stringify(results, null, 2));

if (results.length === 2 &&
    results[0].assetType === 'option' &&
    results[1].assetType === 'stock' &&
    results[1].symbol === 'MSTR' &&
    results[1].quantity === 80) {
    console.log("\nTEST PASSED ✅");
} else {
    console.log("\nTEST FAILED ❌");
}
