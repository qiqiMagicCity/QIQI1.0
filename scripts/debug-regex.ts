
const raw = `91213265: 您的期權訂單Buy Open10張合約GME 02/06/2026 24.000 P已成交1張合約，成交價為$1.11。
15:17PM 01/26/26
    91213265: 您的期權訂單Buy Open10張合約GME 02/06/2026 24.000 P已成交9張合約，成交價為$1.11。
15:17PM 01/26/26`;

function nyLocalToUtcMillis(dateNy: string, hour: number, minute: number): number {
    const [y, m, d] = dateNy.split('-').map((s) => parseInt(s, 10));
    const utcHour = hour + 5;
    return Date.UTC(y, m - 1, d, utcHour, minute, 0);
}

function parseBulkText(raw: string) {
    const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const trades: any[] = [];
    let indexInDay = 0;

    let pendingOpt: any = null;

    for (const line of lines) {
        console.log("Processing line:", line);

        if (pendingOpt) {
            console.log("Checking timestamp against:", line);
            const tsRegex = /^(\d{1,2}):(\d{2})(AM|PM)?\s+(\d{1,2})\/(\d{1,2})\/(\d{2})$/;
            const tsMatch = line.match(tsRegex);

            if (tsMatch) {
                console.log("Timestamp Matched!");
                // ... logic ...
                pendingOpt = null;
                continue;
            } else {
                console.log("Timestamp FAILED match");
                pendingOpt = null;
            }
        }

        const optRegex = /^\d+:\s+您的期[權权]訂[單单](Buy|Sell)\s*(?:Open|Close)?\s*(\d+)張.*?\b([A-Z]+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+([\d\.]+)\s+([PC]).*?已成交(\d+)張.*?成交價為\$([\d\.]+)/i;
        const optMatch = line.match(optRegex);

        if (optMatch) {
            console.log("Option Body Matched!");
            pendingOpt = { matched: true };
            continue;
        } else {
            console.log("Option Body FAILED match");
        }
    }
    return trades;
}

parseBulkText(raw);
