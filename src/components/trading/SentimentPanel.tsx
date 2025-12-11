import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, Newspaper, AlertCircle, RefreshCw } from 'lucide-react';
import { MarketSentiment } from '@/types/trading';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SentimentPanelProps {
  sentiment: MarketSentiment | null;
  isLoading?: boolean;
  onFetch?: () => void;
}

export const SentimentPanel = memo(function SentimentPanel({
  sentiment,
  isLoading,
  onFetch,
}: SentimentPanelProps) {
  if (!sentiment && !isLoading) {
    return (
      <div className="trading-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Newspaper className="h-4 w-4" />
            Market Sentiment
          </h3>
        </div>
        <div className="text-center py-6">
          <Newspaper className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">No sentiment data available</p>
          {onFetch && (
            <Button variant="outline" size="sm" onClick={onFetch}>
              Analyze Sentiment
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="trading-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Newspaper className="h-4 w-4" />
            Market Sentiment
          </h3>
        </div>
        <div className="space-y-3 animate-pulse">
          <div className="h-16 bg-muted rounded" />
          <div className="h-4 bg-muted rounded w-3/4" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!sentiment) return null;

  const sentimentColors = {
    BULLISH: 'text-bullish bg-bullish/10',
    BEARISH: 'text-bearish bg-bearish/10',
    NEUTRAL: 'text-neutral bg-neutral/10',
  };

  const SentimentIcon = sentiment.overall_sentiment === 'BULLISH' 
    ? TrendingUp 
    : sentiment.overall_sentiment === 'BEARISH' 
      ? TrendingDown 
      : Minus;

  const impactColors = {
    high: 'bg-bearish/20 text-bearish',
    medium: 'bg-neutral/20 text-neutral',
    low: 'bg-muted text-muted-foreground',
  };

  const sentimentBadgeColors = {
    positive: 'text-bullish',
    negative: 'text-bearish',
    neutral: 'text-muted-foreground',
  };

  return (
    <div className="trading-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Newspaper className="h-4 w-4" />
          Market Sentiment
        </h3>
        {onFetch && (
          <button
            onClick={onFetch}
            disabled={isLoading}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4 text-muted-foreground', isLoading && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* Overall sentiment */}
      <div className={cn('flex items-center gap-3 p-3 rounded-lg mb-4', sentimentColors[sentiment.overall_sentiment])}>
        <SentimentIcon className="h-8 w-8" />
        <div>
          <p className="font-semibold">{sentiment.overall_sentiment}</p>
          <p className="text-sm opacity-80">Score: {sentiment.sentiment_score}/100</p>
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-muted-foreground mb-4">{sentiment.summary}</p>

      {/* Key factors */}
      {sentiment.key_factors && sentiment.key_factors.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Key Factors</p>
          <div className="flex flex-wrap gap-1.5">
            {sentiment.key_factors.map((factor, i) => (
              <span key={i} className="px-2 py-0.5 bg-secondary text-secondary-foreground text-xs rounded-full">
                {factor}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* News items */}
      {sentiment.news_items && sentiment.news_items.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent News</p>
          <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
            {sentiment.news_items.map((news, i) => (
              <div key={i} className="p-2 bg-secondary/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', sentimentBadgeColors[news.sentiment])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{news.headline}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{news.source}</span>
                      <span className={cn('px-1.5 py-0.5 text-xs rounded', impactColors[news.impact])}>
                        {news.impact}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
