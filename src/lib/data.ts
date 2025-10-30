import { Coins, TrendingUp, Wallet, Zap, Gauge, Scale, Gem, Leaf, Factory, Activity, BarChart, LineChart, CandlestickChart, Percent, DollarSign, type LucideIcon } from 'lucide-react';
import type { Status } from '@/components/ui/status-badge';

export type CalculationModule = {
  id: number;
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative';
  icon: LucideIcon;
};

export const calculationModules: CalculationModule[] = [
  { id: 4, title: 'RSI (AAPL)', value: '68.2', icon: Gauge },
  { id: 5, title: '移动平均 (SPY)', value: '$445.67', change: '-0.2%', changeType: 'negative', icon: LineChart },
  { id: 6, title: '夏普比率', value: '1.8', icon: Scale },
  { id: 7, title: '贝塔系数 (TSLA)', value: '1.5', icon: Zap },
  { id: 8, title: '股息收益率', value: '2.3%', icon: Percent },
  { id: 9, title: '市盈率 (GOOGL)', value: '25.6', icon: Gem },
  { id: 10, title: '市值 (MSFT)', value: '$2.5T', icon: Factory },
  { id: 11, title: 'ESG评分', value: '85/100', icon: Leaf },
  { id: 12, title: '成交量 (NVDA)', value: '50.1M', icon: Activity },
  { id: 13, title: '52周最高价', value: '$180.45', icon: CandlestickChart },
  { id: 14, title: '购买力', value: '$15,000.00', icon: DollarSign },
  { id: 15, title: '持仓数量', value: '12', icon: Coins },
];

export type CoreMetric = {
  id: number;
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative';
  status: Status;
};

export const coreMetrics: CoreMetric[] = [
    { id: 1, title: '总市值', value: '$125,430.88', change: '+2.1%', changeType: 'positive', status: 'live' },
    { id: 2, title: '浮动盈亏 (方向性)', value: '$25,430.88', change: '+25.4%', changeType: 'positive', status: 'stale' },
    { id: 3, title: '当日总盈亏 (方向性)', value: '$1,203.45', change: '+1.1%', changeType: 'positive', status: 'close' },
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
  { symbol: 'AAPL', name: '苹果公司', shares: 150, costBasis: 19500, currentValue: 25500, pl: 6000, plPercent: 30.77 },
  { symbol: 'MSFT', name: '微软公司', shares: 100, costBasis: 30000, currentValue: 34000, pl: 4000, plPercent: 13.33 },
  { symbol: 'TSLA', name: '特斯拉公司', shares: 50, costBasis: 12500, currentValue: 11500, pl: -1000, plPercent: -8.00 },
  { symbol: 'NVDA', name: '英伟达公司', shares: 75, costBasis: 22500, currentValue: 33750, pl: 11250, plPercent: 50.00 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', shares: 80, costBasis: 9600, currentValue: 11200, pl: 1600, plPercent: 16.67 },
];

export type Transaction = {
  id: string;
  userProfileId: string;
  date: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  price: number;
  quantity: number;
  total: number;
};

export const stockChartData = [
  { date: '2023-01-01', price: 130 },
  { date: '2023-01-08', price: 132 },
  { date: '2023-01-15', price: 135 },
  { date: '2023-01-22', price: 140 },
  { date: '2023-01-29', price: 145 },
  { date: '2023-02-05', price: 150 },
  { date: '2023-02-12', price: 152 },
  { date: '2023-02-19', price: 155 },
  { date: '2023-02-26', price: 160 },
  { date: '2023-03-05', price: 158 },
  { date: '2023-03-12', price: 162 },
  { date: '2023-03-19', price: 165 },
  { date: '2023-03-26', price: 170 },
];