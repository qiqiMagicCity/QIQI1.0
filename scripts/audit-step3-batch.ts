
import { getOfficialClosesBatch } from '../src/lib/data/official-close-repo';

async function runBatchAudit() {
    console.log('--- [Step 3 Audit] Batch EOD Trace: Jan 2026 NVDA ---');

    const janDates = [];
    for (let i = 1; i <= 31; i++) {
        const day = i < 10 ? `0${i}` : `${i}`;
        janDates.push(`2026-01-${day}`);
    }

    const symbols = ['NVDA', 'AAPL', 'MSFT', 'TSLA', 'NKE260109C65'];

    try {
        const results = await getOfficialClosesBatch(janDates, symbols);
        console.log('\n[Audit Result Summary]');
        console.log(`Total Keys in Result: ${Object.keys(results).length}`);
        ['2026-01-02', '2026-01-05', '2026-01-06'].forEach(d => {
            console.log(`${d}_NVDA: ${results[`${d}_NVDA`] ? 'FOUND' : 'MISSING'}`);
        });
    } catch (e: any) {
        console.error('Batch Audit failed:', e.message);
    }
}

runBatchAudit();
