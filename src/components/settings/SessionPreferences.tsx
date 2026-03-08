import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Clock, Globe, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface SessionPreferencesProps {
  hasFeature: boolean;
}

const SESSIONS = [
  {
    key: 'allow_london' as const,
    label: 'London Session',
    hours: '07:00 – 16:00 UTC',
    description: 'European markets, highest liquidity for EUR/GBP pairs',
  },
  {
    key: 'allow_newyork' as const,
    label: 'New York Session',
    hours: '12:00 – 21:00 UTC',
    description: 'US markets, overlap with London creates peak volume',
  },
  {
    key: 'allow_asia' as const,
    label: 'Asia Session',
    hours: '23:00 – 08:00 UTC',
    description: 'Tokyo/Sydney markets, best for JPY and AUD pairs',
  },
];

export const SessionPreferences = ({ hasFeature }: SessionPreferencesProps) => {
  const [prefs, setPrefs] = useState({
    allow_london: true,
    allow_newyork: true,
    allow_asia: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('user_session_preferences')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPrefs({
          allow_london: data.allow_london,
          allow_newyork: data.allow_newyork,
          allow_asia: data.allow_asia,
        });
      }
    } catch (err) {
      console.error('Failed to load session preferences:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = async (key: keyof typeof prefs) => {
    if (!hasFeature) return;

    const newPrefs = { ...prefs, [key]: !prefs[key] };

    // Prevent disabling all sessions
    if (!newPrefs.allow_london && !newPrefs.allow_newyork && !newPrefs.allow_asia) {
      toast.error('At least one session must be enabled');
      return;
    }

    setPrefs(newPrefs);
    setIsSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { error } = await supabase
        .from('user_session_preferences')
        .upsert(
          {
            user_id: session.user.id,
            ...newPrefs,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) throw error;
      toast.success('Session preference updated');
    } catch (err) {
      console.error('Failed to save session preferences:', err);
      toast.error('Failed to save preference');
      setPrefs(prefs); // revert
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <section className="premium-card p-6 lg:p-8">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Trading Sessions</h2>
        </div>
        {!hasFeature && (
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" />
            Funded Plan
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Choose which trading sessions you want to receive signals for. Signals outside your selected sessions will be filtered out.
      </p>

      <div className="space-y-4">
        {SESSIONS.map((session) => (
          <div
            key={session.key}
            className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
              hasFeature
                ? 'border-border bg-muted/30 hover:bg-muted/50'
                : 'border-border/50 bg-muted/10 opacity-60'
            }`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{session.label}</span>
                  <span className="text-xs text-muted-foreground">{session.hours}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{session.description}</p>
              </div>
            </div>
            <div className="ml-4 shrink-0">
              <Switch
                checked={prefs[session.key]}
                onCheckedChange={() => handleToggle(session.key)}
                disabled={!hasFeature || isSaving}
              />
            </div>
          </div>
        ))}
      </div>

      {!hasFeature && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          Upgrade to the Funded Trader plan to filter signals by trading session.
        </p>
      )}
    </section>
  );
};
