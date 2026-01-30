import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import GlobalAddTransactionFab from '@/components/global-add-transaction-fab';
import { RealTimePricesProvider } from '@/price/RealTimePricesProvider';
import { EodAutoManager } from '@/components/eod-auto-manager';
import { HoldingsProvider } from '@/contexts/holdings-provider';
import { ThemeProvider } from '@/contexts/theme-provider';
import { PwaRegister } from '@/components/pwa-register';


export const metadata: Metadata = {
  title: {
    default: "LuckTrading 777",
    template: "%s · LuckTrading 777",
  },
  description: '一个绿色主题的交易分析网站。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=LXGW+WenKai+Mono+TC:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@400;500;700&family=ZCOOL+KuaiLe&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/favicon.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="font-body antialiased">
        <FirebaseClientProvider>
          <ThemeProvider>
            {/* ✅ 在 Firebase 上下文内部，包住页面与悬浮入口 */}
            <RealTimePricesProvider>
              <HoldingsProvider>
                <div className="mx-auto w-[94%] max-w-[1600px] min-h-screen flex flex-col bg-background shadow-2xl shadow-black/5">
                  <EodAutoManager />
                  {children}
                </div>
                <Suspense fallback={null}>
                  <GlobalAddTransactionFab />
                </Suspense>
              </HoldingsProvider>
            </RealTimePricesProvider>
          </ThemeProvider>
        </FirebaseClientProvider>
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
