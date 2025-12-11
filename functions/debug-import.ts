import yahooFinance from 'yahoo-finance2';
// also try star import
import * as yfStar from 'yahoo-finance2';

console.log("--- DEBUG IMPORT START ---");
console.log("typeof default import:", typeof yahooFinance);
try { console.log("default import keys:", Object.keys(yahooFinance)); } catch (e) { console.log("keys err", e.message); }
console.log("default.historical type:", typeof (yahooFinance as any).historical);
console.log("default.default type:", typeof (yahooFinance as any).default);

console.log("typeof star import:", typeof yfStar);
console.log("star.historical type:", typeof (yfStar as any).historical);
console.log("star.default type:", typeof (yfStar as any).default);
console.log("--- DEBUG IMPORT END ---");
