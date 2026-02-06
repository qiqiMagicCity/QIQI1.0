
function parseOptionSymbol(raw: string) {
    const regex = /^([A-Z]+)(\d{6})([CP])([\d\.]+)$/;
    const match = raw.match(regex);
    if (!match) return null;

    const [, underlying, dateStr, right, strike] = match;
    return { underlying, dateStr, right, strike };
}

const symbols = [
    'GOOGL260918C150',
    'NVO261218C50',
    'NIO260618P3.5',
    'INTC240308P40.5',
    'AAPL260206C270'
];

symbols.forEach(s => {
    console.log(`${s} ->`, parseOptionSymbol(s));
});
