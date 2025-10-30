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
  { id: 1, title: '名义总风险', value: '$8,240', change: '+5.2%', changeType: 'positive', icon: Gauge },
  { id: 2, title: '方向性风险', value: '$1,230', change: '-1.8%', changeType: 'negative', icon: Scale },
  { id: 3, title: '最大单边仓位', value: 'TSLA多头', change: '$4,500', changeType: 'positive', icon: Gem },
  { id: 4, title: 'Alpha-纯多头', value: '$7,890', change: '+12.5%', changeType: 'positive', icon: Leaf },
  { id: 5, title: 'Beta-对冲', value: '$-2,110', change: '-3.1%', changeType: 'negative', icon: Factory },
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
  { id: 1, title: '总资产', value: '$108,230.89', change: '+$1,230.45 (+1.15%)', changeType: 'positive', status: 'live' },
  { id: 2, title: '持仓成本', value: '$95,400.12', status: 'close' },
  { id: 3, title: '持仓浮盈', value: '+$12,830.77', change: '+13.45%', changeType: 'positive', status: 'live' },
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
  { symbol: 'AAPL', name: '苹果公司', shares: 150, costBasis: 145.20, currentValue: 25500, pl: 4470, plPercent: 20.95 },
  { symbol: 'TSLA', name: '特斯拉', shares: 50, costBasis: 220.80, currentValue: 12500, pl: 1460, plPercent: 13.22 },
  { symbol: 'NVDA', name: '英伟达', shares: 75, costBasis: 450.00, currentValue: 67500, pl: 33750, plPercent: 100 },
  { symbol: 'NFLX', name: '奈飞', shares: -50, costBasis: 430.50, currentValue: -22500, pl: -1025, plPercent: -4.76 },
];

export type Transaction = {
  id: string;
  userId: string;
  transactionDate: string;
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
