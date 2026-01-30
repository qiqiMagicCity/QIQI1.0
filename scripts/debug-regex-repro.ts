
const input1 = "91213265: 您的期权订单Buy Open10张合约GME 02/06/2026 24.000 P已成交1張合約，成交价位$1.11。	15:17PM 01/26/26";
const input2 = "91213265: 您的卖出订单477股GGLL已成交477股，成交价位$109.3559。	14:59PM 01/26/26";

// Regexes from Step 334
const singleLineOptRegex = /^\d+\s*[:：]\s+您的期[權权]訂[單单](Buy|Sell).*?(?:Open|Close|)?\s*(\d+)[張张].*?\b([A-Z]+)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+([\d\.]+)\s+([PC]).*?已成交(\d+)\s*[張张].*?成交[價价][為位][\$]([\d\.]+)[。\.\s\t]*(\d{1,2}):(\d{2})(AM|PM|am|pm)?\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i;

const cnRegex = /^\d+\s*[:：]\s+您的(买进|卖空|卖出|买回|平仓|卖空补回)[訂订][單单].*?股([A-Za-z]+)已成交(\d+)股，成交[價价][位為]\$([\d\.]+)[。.]?\s*(\d{1,2}):(\d{2})(AM|PM)?\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

console.log("--- Testing Option Regex ---");
const match1 = input1.match(singleLineOptRegex);
if (match1) {
    console.log("MATCH OPTION!");
    console.log(match1.slice(1));
} else {
    console.log("FAIL OPTION");
    // Debug partials
    const parts = [
        /^\d+\s*[:：]\s+/,
        /您的期[權权]訂[單单]/,
        /(Buy|Sell)/,
        /.*?(?:Open|Close|)?\s*(\d+)[張张]/,
        /.*?\b([A-Z]+)/,
        /\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
        /\s+([\d\.]+)/,
        /\s+([PC])/,
        /.*?已成交(\d+)\s*[張张]/,
        /.*?成交[價价][為位][\$]([\d\.]+)/,
        /[。\.\s\t]*(\d{1,2}):(\d{2})/
    ];
    let currentStr = input1;
    parts.forEach((p, i) => {
        const m = currentStr.match(p);
        if (m) {
            console.log(`Part ${i} OK: '${m[0]}'`);
            // Consume match to test next (rough approx)
            // Actually regex is one big string, testing parts is hard if they use start anchor ^
            // But we can test if pattern exists in string.
        } else {
            console.log(`Part ${i} FAIL: ${p}`);
        }
    });
}

console.log("\n--- Testing Stock Regex ---");
const match2 = input2.match(cnRegex);
if (match2) {
    console.log("MATCH STOCK!");
    console.log(match2.slice(1));
} else {
    console.log("FAIL STOCK");
    console.log("Input:", input2);
}
