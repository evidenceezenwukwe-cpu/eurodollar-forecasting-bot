import { memo } from 'react';
import { Timeframe } from '@/types/trading';
import { cn } from '@/lib/utils';

interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}

const timeframes: { value: Timeframe; label: string }[] = [
  { value: '1min', label: '1m' },
  { value: '5min', label: '5m' },
  { value: '15min', label: '15m' },
  { value: '30min', label: '30m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
];

export const TimeframeSelector = memo(function TimeframeSelector({
  value,
  onChange,
}: TimeframeSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg">
      {timeframes.map((tf) => (
        <button
          key={tf.value}
          onClick={() => onChange(tf.value)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            value === tf.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
          )}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
});
