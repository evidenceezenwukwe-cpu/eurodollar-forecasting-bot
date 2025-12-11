import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PriceDisplayProps {
  price: number | null;
  previousPrice?: number | null;
  symbol?: string;
  isLoading?: boolean;
  lastUpdated?: Date | null;
  onRefresh?: () => void;
}

export const PriceDisplay = memo(function PriceDisplay({
  price,
  previousPrice,
  symbol = 'EUR/USD',
  isLoading,
  lastUpdated,
  onRefresh,
}: PriceDisplayProps) {
  const priceChange = price && previousPrice ? price - previousPrice : 0;
  const isUp = priceChange > 0;
  const isDown = priceChange < 0;

  return (
    <div className="trading-card p-4 md:p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground font-medium">{symbol}</span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4 text-muted-foreground', isLoading && 'animate-spin')} />
          </button>
        )}
      </div>

      <div className="flex items-baseline gap-3">
        {price !== null ? (
          <>
            <span className="text-3xl md:text-4xl font-mono font-bold tracking-tight">
              {price.toFixed(5)}
            </span>
            <div
              className={cn(
                'flex items-center gap-1 text-sm font-medium',
                isUp && 'text-bullish',
                isDown && 'text-bearish',
                !isUp && !isDown && 'text-muted-foreground'
              )}
            >
              {isUp && <TrendingUp className="h-4 w-4" />}
              {isDown && <TrendingDown className="h-4 w-4" />}
              {!isUp && !isDown && <Minus className="h-4 w-4" />}
              <span>{priceChange >= 0 ? '+' : ''}{priceChange.toFixed(5)}</span>
            </div>
          </>
        ) : (
          <div className="h-10 w-40 bg-muted animate-pulse rounded" />
        )}
      </div>

      {lastUpdated && (
        <p className="text-xs text-muted-foreground mt-2">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
});
