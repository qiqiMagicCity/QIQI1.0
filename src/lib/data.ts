import { Coins, TrendingUp, Wallet, Zap, Gauge, Scale, Gem, Leaf, Factory, Activity, BarChart, LineChart, CandlestickChart, Percent, DollarSign, type LucideIcon } from 'lucide-react';

export type CalculationModule = {
  id: number;
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative';
  icon: LucideIcon;
};

export const calculationModules: CalculationModule[] = [
  { id: 1, title: 'Portfolio Value', value: '$125,430.88', change: '+2.1%', changeType: 'positive', icon: Wallet },
  { id: 2, title: 'Day\'s P/L', value: '$1,203.45', change: '+1.1%', changeType: 'positive', icon: TrendingUp },
  { id: 3, title: 'Overall P/L', value: '$25,430.88', change: '+25.4%', changeType: 'positive', icon: BarChart },
  { id: 4, title: 'RSI (AAPL)', value: '68.2', icon: Gauge },
  { id: 5, title: 'Moving Avg (SPY)', value: '$445.67', change: '-0.2%', changeType: 'negative', icon: LineChart },
  { id: 6, title: 'Sharpe Ratio', value: '1.8', icon: Scale },
  { id: 7, title: 'Beta (TSLA)', value: '1.5', icon: Zap },
  { id: 8, title: 'Dividend Yield', value: '2.3%', icon: Percent },
  { id: 9, title: 'P/E Ratio (GOOGL)', value: '25.6', icon: Gem },
  { id: 10, title: 'Market Cap (MSFT)', value: '$2.5T', icon: Factory },
  { id: 11, title: 'ESG Score', value: '85/100', icon: Leaf },
  { id: 12, title: 'Volume (NVDA)', value: '50.1M', icon: Activity },
  { id: 13, title: '52-Week High', value: '$180.45', icon: CandlestickChart },
  { id: 14, title: 'Buying Power', value: '$15,000.00', icon: DollarSign },
  { id: 15, title: 'Open Positions', value: '12', icon: Coins },
];

export type Holding = {
  symbol: string;
  name: string;
  shares: number;
  costBasis: number;
  currentValue: number;
  pl: number;
  plPercent: number;
};

export const holdings: Holding[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', shares: 150, costBasis: 19500, currentValue: 25500, pl: 6000, plPercent: 30.77 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', shares: 100, costBasis: 30000, currentValue: 34000, pl: 4000, plPercent: 13.33 },
  { symbol: 'TSLA', name: 'Tesla, Inc.', shares: 50, costBasis: 12500, currentValue: 11500, pl: -1000, plPercent: -8.00 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', shares: 75, costBasis: 22500, currentValue: 33750, pl: 11250, plPercent: 50.00 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', shares: 80, costBasis: 9600, currentValue: 11200, pl: 1600, plPercent: 16.67 },
];

export type Transaction = {
  id: string;
  date: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  price: number;
  quantity: number;
  total: number;
};

export const transactions: Transaction[] = [
  { id: 'txn1', date: '2023-10-26', symbol: 'NVDA', type: 'Buy', price: 300, quantity: 25, total: 7500 },
  { id: 'txn2', date: '2023-10-24', symbol: 'AAPL', type: 'Sell', price: 170, quantity: 50, total: 8500 },
  { id: 'txn3', date: '2023-10-20', symbol: 'TSLA', type: 'Buy', price: 250, quantity: 50, total: 12500 },
  { id: 'txn4', date: '2023-10-15', symbol: 'MSFT', type: 'Buy', price: 300, quantity: 100, total: 30000 },
  { id: 'txn5', date: '2023-10-10', symbol: 'GOOGL', type: 'Buy', price: 120, quantity: 80, total: 9600 },
  { id: 'txn6', date: '2023-09-01', symbol: 'AAPL', type: 'Buy', price: 130, quantity: 200, total: 26000 },
];

export const stockChartData = [
  { date: 'Jan 23', price: 160 },
  { date: 'Feb 23', price: 165 },
  { date: 'Mar 23', price: 175 },
  { date: 'Apr 23', price: 170 },
  { date: 'May 23', price: 180 },
  { date: 'Jun 23', price: 185 },
  { date: 'Jul 23', price: 195 },
  { date: 'Aug 23', price: 190 },
  { date: 'Sep 23', price: 188 },
  { date: 'Oct 23', price: 170 },
  { date: 'Nov 23', price: 192 },
  { date: 'Dec 23', price: 200 },
];
