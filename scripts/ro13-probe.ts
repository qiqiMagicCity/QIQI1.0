
import { toNyCalendarDayString } from '../src/lib/ny-time';
import { startOfMonth } from 'date-fns';

console.log("=== [EVID] RO-13: Timezone Boundary Audit ===");

// Simulation of use-daily-pnl.ts logic:
// const start = startOfMonth(currentMonth);
// const monthId = toNyCalendarDayString(start).substring(0, 7);

function testLocalTimeRisk(localTimeISO: string) {
    const localDate = new Date(localTimeISO);
    const start = startOfMonth(localDate);
    const monthId = toNyCalendarDayString(start).substring(0, 7);

    return {
        local: localTimeISO,
        startOfLocalMonth: start.toISOString(),
        nyInterpretation: toNyCalendarDayString(start),
        monthId
    };
}

console.log("\n--- C) Inconsistency Fork Point Detection ---");

// Risk Case: User in Hong Kong (UTC+8) looking at Feb 1st 2026
// At 2026-02-01 00:00:00 UTC+8
const res = testLocalTimeRisk("2026-02-01T00:00:00+08:00");
console.log("User in HK (UTC+8) clicks Feb 1st:");
console.log(JSON.stringify(res, null, 2));

// This proves that if we use local 'startOfMonth', the monthId can diverge!
if (res.monthId === "2026-01") {
    console.warn("\n[ALERT] First Fork Point Identified: use-daily-pnl.ts line 42");
    console.warn("Issue: monthId generation uses local-time based startOfMonth.");
    console.warn("Result: User in UTC+8 sees Feb 1st transactions calculated into January snapshot.");
}
