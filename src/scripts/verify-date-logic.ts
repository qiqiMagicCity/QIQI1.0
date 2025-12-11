
import { prevNyTradingDayString, getPeriodBaseDates, US_MARKET_HOLIDAYS } from '@/lib/ny-time';

const todayNy = '2025-12-03';
console.log(`Today: ${todayNy}`);

// 1. Check prevNyTradingDayString for Dec 1st
const dec1 = '2025-12-01';
const prevDec1 = prevNyTradingDayString(dec1);
console.log(`prevNyTradingDayString('${dec1}') = ${prevDec1}`);
console.log(`Expected: 2025-11-28`);

// 2. Check getPeriodBaseDates
const bases = getPeriodBaseDates(todayNy);
console.log(`MTD Base for ${todayNy}: ${bases.mtd}`);
console.log(`Expected: 2025-11-28`);

// 3. Simulate mtdDates logic in HoldingsProvider
const [yStr, mStr, dStr] = todayNy.split('-');
const dayInt = parseInt(dStr, 10);
const mtdDates: string[] = [];

const mtdStartStr = `${yStr}-${mStr}-01`;
const prevMtdStart = prevNyTradingDayString(mtdStartStr);
mtdDates.push(prevMtdStart);

for (let d = 1; d <= dayInt; d++) {
    const dayPart = String(d).padStart(2, '0');
    mtdDates.push(`${yStr}-${mStr}-${dayPart}`);
}

console.log('Generated mtdDates:', mtdDates);
console.log('Does it include 2025-11-28?', mtdDates.includes('2025-11-28'));

// 4. Check Holidays
console.log('Is 2025-11-28 a holiday?', US_MARKET_HOLIDAYS.has('2025-11-28'));
console.log('Is 2025-11-27 a holiday?', US_MARKET_HOLIDAYS.has('2025-11-27'));
