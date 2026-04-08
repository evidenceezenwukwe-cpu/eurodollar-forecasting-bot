import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ForexData, Timeframe } from '@/types/trading';

export function useForexData(timeframe: Timeframe = '1h', symbol: string = 'EUR/USD') {
  const [data, setData] = useState<ForexData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const outputsizeByTimeframe: Record<Timeframe, number> = {
        '1min': 180,
        '5min': 150,
        '15min': 150,
        '30min': 150,
        '1h': 200,
        '4h': 200,
      };

      const { data: result, error: fnError } = await supabase.functions.invoke('fetch-forex-data', {
        body: { timeframe, outputsize: outputsizeByTimeframe[timeframe] ?? 200, symbol },
      });

      if (fnError) throw fnError;

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to fetch forex data');
      }

      setData({
        symbol: result.symbol,
        currentPrice: result.currentPrice,
        candles: result.candles,
        meta: result.meta,
      });
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching forex data:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch data';

      // Fallback: load cached candles directly from the backend cache table.
      // Try the requested timeframe first, then fall back to 4h and 15min.
      const fallbackTimeframes = [timeframe, '4h', '15min'].filter((v, i, a) => a.indexOf(v) === i);
      let cachedRows: any[] | null = null;
      let usedTimeframe = timeframe;

      for (const tf of fallbackTimeframes) {
        const { data: rows, error: cacheError } = await supabase
          .from('price_history')
          .select('timestamp, open, high, low, close, volume')
          .eq('symbol', symbol)
          .eq('timeframe', tf)
          .order('timestamp', { ascending: true })
          .limit(300);

        if (!cacheError && rows && rows.length > 0) {
          cachedRows = rows;
          usedTimeframe = tf;
          break;
        }
      }

      if (cachedRows && cachedRows.length > 0) {
        const candles = cachedRows.map((row) => ({
          timestamp: row.timestamp,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: row.volume === null ? undefined : Number(row.volume),
        }));

        setData({
          symbol,
          currentPrice: candles[candles.length - 1]?.close ?? 0,
          candles,
          meta: { source: 'cache_fallback', timeframe: usedTimeframe, warning: message },
        });
        setLastUpdated(new Date());
        setError(`Using cached data: ${message}`);
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [timeframe, symbol]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh (much slower to conserve API credits - backend cron handles updates)
  useEffect(() => {
    const refreshMsByTimeframe: Record<Timeframe, number> = {
      '1min': 120_000,     // 2 minutes (was 30s)
      '5min': 300_000,     // 5 minutes (was 1min)
      '15min': 600_000,    // 10 minutes (was 2min)
      '30min': 900_000,    // 15 minutes (was 5min)
      '1h': 1_800_000,     // 30 minutes (was 5min)
      '4h': 3_600_000,     // 1 hour (was 15min)
    };

    const interval = setInterval(fetchData, refreshMsByTimeframe[timeframe] ?? 1_800_000);
    return () => clearInterval(interval);
  }, [fetchData, timeframe]);

  return { data, isLoading, error, refetch: fetchData, lastUpdated };
}
