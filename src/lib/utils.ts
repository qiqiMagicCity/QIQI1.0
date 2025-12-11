import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const formatCurrency = (value: number | null | undefined) => {
  if (value == null || typeof value !== 'number') return '—';
  const sign = value > 0 ? '+' : '';
  return sign + value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const formatNumber = (value: number | null | undefined) => {
  if (value == null || typeof value !== 'number') return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
};

export const normalizeSymbolClient = (s: string): string =>
  (s ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
