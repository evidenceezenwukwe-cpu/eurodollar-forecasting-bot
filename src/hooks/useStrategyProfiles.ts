import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StrategyProfile {
  id: string;
  name: string;
  htf: string;
  trigger_tf: string;
  entry_tf: string;
  settings: Record<string, any> | null;
  shared: boolean;
  user_id: string | null;
}

const TF_LABELS: Record<string, string> = {
  '1w': 'W1',
  '1d': 'D1',
  '4h': 'H4',
  '1h': 'H1',
  '30min': 'M30',
  '15min': 'M15',
  '5min': 'M5',
  '1min': 'M1',
};

export function formatTFLabel(tf: string): string {
  return TF_LABELS[tf] || tf.toUpperCase();
}

export function useStrategyProfiles() {
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfiles = useCallback(async () => {
    try {
      // Fetch shared profiles (available to everyone)
      const { data: sharedData, error: sharedError } = await supabase
        .from('strategy_profiles')
        .select('*')
        .eq('shared', true)
        .order('name');

      if (sharedError) throw sharedError;

      // Fetch user's own profiles
      const { data: { session } } = await supabase.auth.getSession();
      let userData: StrategyProfile[] = [];

      if (session) {
        const { data, error } = await supabase
          .from('strategy_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .order('name');

        if (!error && data) {
          userData = data as unknown as StrategyProfile[];
        }
      }

      const all = [...(sharedData as unknown as StrategyProfile[] || []), ...userData];
      setProfiles(all);

      // Default to first shared profile (Swing) if no active selection
      if (!activeProfileId && all.length > 0) {
        const swing = all.find(p => p.name.toLowerCase().includes('swing'));
        setActiveProfileId(swing?.id || all[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch strategy profiles:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || null;

  return {
    profiles,
    activeProfile,
    activeProfileId,
    setActiveProfileId,
    isLoading,
    refetch: fetchProfiles,
  };
}
