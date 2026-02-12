
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// Force dynamic to ensure fresh fetches
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!symbol) {
        return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
    }

    try {
        const queryOptions: any = { period1: from || '2023-01-01' }; // Default to reasonable start
        if (to) queryOptions.period2 = to;

        // Suppress console spam from yahoo-finance2
        const originalWarn = console.warn;
        console.warn = () => { };

        const result = await yahooFinance.historical(symbol, queryOptions);

        console.warn = originalWarn; // Restore

        return NextResponse.json({
            symbol,
            data: result
        });

    } catch (e: any) {
        console.error(`Local Yahoo Proxy Error for ${symbol}:`, e.message);
        return NextResponse.json({
            error: e.message,
            symbol
        }, { status: 500 });
    }
}
