import { CandlestickChart, BadgeDollarSign } from "lucide-react";

export interface AssetTypeIconProps {
  assetType: 'stock' | 'option' | 'options';
  className?: string;
  title?: string;
}

export function AssetTypeIcon({ assetType, className, title }: AssetTypeIconProps) {
  const kind = assetType === 'options' ? 'option' : assetType;
  const label = kind === 'stock' ? '股票' : kind === 'option' ? '期权' : '资产';

  if (kind === 'stock') {
    return <CandlestickChart className={className} aria-label={label} role="img" />;
  }
  if (kind === 'option') {
    return <BadgeDollarSign className={className} aria-label={label} role="img" />;
  }
  return null;
}
