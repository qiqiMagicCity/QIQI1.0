'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 可选：将错误打点到控制台/外部监控（此处仅控制台，禁止引入新依赖）
  // 注意：不要在这里抛出异常
  React.useEffect(() => {
    // 避免在生产泄露过多细节，这里只做基础记录
    // 未来若接入 APM，可在此上报 error.message / error.stack / error.digest
    // eslint-disable-next-line no-console
    console.error('[GlobalError]', {
      message: error?.message,
      digest: (error as any)?.digest,
    });
  }, [error]);

  const msg = error?.message ?? 'Unexpected error';

  const handleCopy = async () => {
    try {
      const payload = [
        `message: ${msg}`,
        `digest: ${(error as any)?.digest ?? 'n/a'}`,
        `time: ${new Date().toISOString()}`,
      ].join('\n');
      await navigator.clipboard.writeText(payload);
      alert('错误信息已复制。');
    } catch {
      alert('复制失败，请手动截图或复制。');
    }
  };

  return (
    <html>
      <body className="min-h-screen w-full flex items-center justify-center p-6">
        <div
          className={cn(
            'max-w-lg w-full rounded-2xl border p-6 shadow-sm',
            'bg-card text-card-foreground'
          )}
        >
          <h1 className="text-xl font-semibold mb-2">页面出错了</h1>
          <p className="text-sm text-muted-foreground mb-4">
            我们已拦截到一次渲染异常。您可以尝试重试或返回首页。
          </p>

          <div className="rounded-md border bg-muted/40 p-3 mb-4">
            <p className="text-xs font-mono break-all leading-5">
              {msg}
              {(error as any)?.digest ? (
                <>
                  <br />
                  <span className="opacity-70">digest: {(error as any)?.digest}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => reset()} className="shrink-0">
              重试
            </Button>
            <Link href="/" className="shrink-0">
              <Button variant="outline">返回首页</Button>
            </Link>
            <Button variant="ghost" onClick={handleCopy} className="ml-auto">
              复制错误信息
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
