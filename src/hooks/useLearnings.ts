import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Learning {
  id: string;
  prediction_id: string;
  pattern_context: {
    patterns: string[];
    indicators: Record<string, number>;
    signal_type: string;
    confidence: number;
  } | null;
  market_conditions: {
    entry_price: number;
    outcome_price: number;
    trend_direction: string;
    trend_strength: number;
    sentiment_score: number;
  } | null;
  lesson_extracted: string;
  failure_reason: string | null;
  success_factors: string | null;
  created_at: string;
}

export function useLearnings() {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLearnings = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data, error: fetchError } = await supabase
        .from('prediction_learnings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;

      setLearnings((data || []) as Learning[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch learnings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLearnings();
  }, [fetchLearnings]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('learnings-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'prediction_learnings'
        },
        (payload) => {
          const newLearning = payload.new as Learning;
          setLearnings(prev => [newLearning, ...prev].slice(0, 50));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const stats = {
    total: learnings.length,
    successes: learnings.filter(l => l.success_factors).length,
    failures: learnings.filter(l => l.failure_reason).length,
  };

  return { learnings, isLoading, error, refetch: fetchLearnings, stats };
}
