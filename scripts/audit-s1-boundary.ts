
import { toNyCalendarDayString, prevNyTradingDayString, isNyTradingDay } from '../src/lib/ny-time';

// Simulation of Repo Logic
function simulateRepo(startDate: string, endDate: string, maxDays = 5) {
    const dates: string[] = [];
    let curr = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    let isTruncated = false;
    let lastResultDate = startDate;

    while (curr <= end) {
        if (count >= maxDays) {
            isTruncated = true;
            break;
        }
        const dStr = curr.toISOString().split('T')[0];
        if (isNyTradingDay(dStr)) {
            dates.push(dStr);
            lastResultDate = dStr;
        }
        curr.setDate(curr.getDate() + 1);
        count++;
    }

    const results: any = {};
    dates.forEach(d => {
        results[`${d}_AAPL`] = { status: 'ok', close: 150 };
    });

    if (isTruncated) {
        results['FETCH_INCOMPLETE_BOUNDARY'] = {
            status: 'fetch_incomplete',
            meta: { lastFetchedDate: lastResultDate, endDate }
        };
    }
    return results;
}

// Simulation of Engine Logic
function simulateEngine(targetDates: string[], eodMap: any) {
    const boundary = eodMap['FETCH_INCOMPLETE_BOUNDARY'];
    const truncationPoint = boundary?.meta?.lastFetchedDate;

    return targetDates.map(currentDate => {
        const isTruncated = truncationPoint && currentDate > truncationPoint;
        let status = 'ok';
        let isMissing = false;

        const eod = eodMap[`${currentDate}_AAPL`];
        if (eod?.status === 'ok') {
            status = 'ok';
        } else {
            isMissing = true;
        }

        if (isTruncated) {
            status = 'fetch_incomplete';
            isMissing = false;
        } else if (isMissing) {
            status = 'missing_data';
        }

        return { date: currentDate, status };
    });
}

const startDate = '2024-01-01';
const endDate = '2024-01-15';
const targetDates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07', '2024-01-08', '2024-01-09', '2024-01-10'];

console.log('--- Simulation Started ---');
const eodMap = simulateRepo(startDate, endDate, 5);
console.log('Repo Boundary Meta:', JSON.stringify(eodMap['FETCH_INCOMPLETE_BOUNDARY'], null, 2));

const engineResults = simulateEngine(targetDates, eodMap);
console.log('Engine Output Sample:');
engineResults.forEach(r => console.log(`${r.date}: ${r.status}`));

// Verification
const truncatedCount = engineResults.filter(r => r.status === 'fetch_incomplete').length;
const missingDataCount = engineResults.filter(r => r.status === 'missing_data').length;

console.log('--- Verification ---');
console.log('Truncated Days:', truncatedCount);
console.log('Missing Data Days:', missingDataCount);

if (truncatedCount > 0 && missingDataCount === 0) {
    console.log('AUDIT PASSED: fetch_incomplete isolated from missing_data.');
} else {
    console.log('AUDIT FAILED: Separation failed.');
}
