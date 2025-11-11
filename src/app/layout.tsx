import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import GlobalAddTransactionFab from '@/components/global-add-transaction-fab';

// ✅ 新增：统一实时报价中心 Provider（依赖 Firebase 上下文）
import { RealTimePricesProvider } from '@/price/RealTimePricesProvider';

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
      </head>
      <body className="font-body antialiased">
        <FirebaseClientProvider>
          {/* ✅ 在 Firebase 上下文内部，包住页面与悬浮入口 */}
          <RealTimePricesProvider>
            {children}
            <GlobalAddTransactionFab />
          </RealTimePricesProvider>
        </FirebaseClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
