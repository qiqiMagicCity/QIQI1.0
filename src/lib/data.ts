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

// 清空分析仪表盘的示例数据
export const calculationModules: CalculationModule[] = [];

export type CoreMetric = {
  id: number;
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative';
  status: Status;
};

// 清空核心指标卡片的示例数据
export const coreMetrics: CoreMetric[] = [];


export type Holding = {
  symbol: string;
  name: string;
  shares: number;
  costBasis: number;
  currentValue: number;
  pl: number;
  plPercent: number;
};

// 清空持仓列表的示例数据
export const holdings: Holding[] = [];

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
