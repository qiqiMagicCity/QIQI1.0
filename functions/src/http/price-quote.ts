// functions/src/http/price-quote.ts

// 说明：
// 这个文件只做“兼容旧入口”的转发。
// 历史代码里如果还有地方用 `./http/price-quote` 引入 priceQuote，
// 通过这里统一转发到新的 Finnhub 实现（functions/src/price/price-quote.ts）。

import { priceQuote as finnhubPriceQuote } from "../price/price-quote";

// 对外仍然导出同名的 priceQuote（实时报价云函数 Cloud Function），
// 但内部完全复用 Finnhub 版本的实现逻辑。
export const priceQuote = finnhubPriceQuote;
