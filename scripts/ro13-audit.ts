
import { toNyCalendarDayString } from '../src/lib/ny-time';

function getMonthId(dateStr: string) {
    return dateStr.substring(0, 7);
}

function runTestCase(name: string, nyTimeStr: string) {
    const d = new Date(nyTimeStr);
    const actualDay = toNyCalendarDayString(d);
    const actualMonth = getMonthId(actualDay);

    return `${name} | Input: ${nyTimeStr} | Day: ${actualDay} | Month: ${actualMonth}`;
}

console.log("=== [EVID] RO-13: Timezone Boundary Audit ===");

const cases = [
    { name: "Case 1", input: "2026-01-31T23:59:30-05:00" },
    { name: "Case 2", input: "2026-02-01T00:00:30-05:00" },
    { name: "Case 3", input: "2026-02-11T00:00:30-05:00" },
    { name: "Case 4", input: "2026-02-11T23:59:30-05:00" },
    { name: "Case 5", input: "2026-02-14T12:00:00-05:00" },
    { name: "Case 6", input: "2026-01-01T12:00:00-05:00" },
];

cases.forEach(c => {
    console.log(runTestCase(c.name, c.input));
});

console.log("\n--- A) Entry Point Registry ---");
console.log("1. UI/Display: toNyCalendarDayString (src/lib/ny-time.ts:51)");
console.log("2. Month Slicing: result.substring(0, 7) (various UI components)");
console.log("3. Backend Jobs: nowNyCalendarDayString (functions/src/lib/ny-time.ts)");
console.log("4. Cron Schedule: 23:30 America/New_York (functions/src/jobs/generate-daily-snapshot.ts:232)");
