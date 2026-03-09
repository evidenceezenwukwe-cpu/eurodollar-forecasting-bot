import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useFeatureAccess = () => {
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  const checkFeature = useCallback(async (feature: string): Promise<boolean> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      const { data, error } = await supabase.rpc('has_feature', {
        _user_id: session.user.id,
        _feature: feature,
      });

      if (error) {
        console.error('Feature check error:', error);
        return false;
      }

      return !!data;
    } catch {
      return false;
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    setIsLoading(true);
    const featureKeys = [
      'daily_bias', 'entry_levels', 'pattern_detection', 'track_record',
      'opportunities', 'backtesting', 'telegram_alerts', 'session_filters',
      'prop_firm_compliance', 'advanced_pattern_stats', 'multi_timeframe_profiles',
      'priority_support',
    ];

    const results: Record<string, boolean> = {};
    for (const key of featureKeys) {
      results[key] = await checkFeature(key);
    }

    setFeatures(results);
    setIsLoading(false);
  }, [checkFeature]);

  useEffect(() => {
    loadFeatures();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadFeatures();
    });

    return () => subscription.unsubscribe();
  }, [loadFeatures]);

  const hasFeature = useCallback(
    (feature: string) => features[feature] ?? false,
    [features]
  );

  return { hasFeature, isLoading, refreshFeatures: loadFeatures };
};
