import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // 明确在 Node.js 运行（避免边缘运行时差异）

export async function GET() {
  const body = {
    status: 'ok',
    time: new Date().toISOString(),
    runtime: process.env.NEXT_RUNTIME ?? 'node',
    node: process.versions?.node ?? 'unknown',
    nextVersion: '15.3.3',
  };

  return NextResponse.json(body, {
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
    status: 200,
  });
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}
