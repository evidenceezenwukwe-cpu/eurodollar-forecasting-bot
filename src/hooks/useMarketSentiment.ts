import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MarketSentiment } from '@/types/trading';

export function useMarketSentiment() {
  const [sentiment, setSentiment] = useState<MarketSentiment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSentiment = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('fetch-news-sentiment', {
        body: {},
      });

      if (fnError) throw fnError;

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch sentiment');
      }

      setSentiment(result.sentiment);
      return result.sentiment;
    } catch (err) {
      console.error('Error fetching sentiment:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch sentiment';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { sentiment, isLoading, error, fetchSentiment };
}
