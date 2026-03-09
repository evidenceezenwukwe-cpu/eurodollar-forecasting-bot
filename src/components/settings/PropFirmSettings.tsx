import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface PropFirmSettingsProps {
  hasFeature: boolean;
}

export const PropFirmSettings = ({ hasFeature }: PropFirmSettingsProps) => {
  const [enabled, setEnabled] = useState(false);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(5);
  const [maxOpenTrades, setMaxOpenTrades] = useState(3);
  const [maxRiskPercent, setMaxRiskPercent] = useState(1.0);
  const [maxDailyLossPercent, setMaxDailyLossPercent] = useState(3.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadConstraints();
  }, []);

  const loadConstraints = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('user_prop_constraints')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (data) {
        setEnabled(data.enabled);
        setMaxTradesPerDay(data.max_trades_per_day);
        setMaxOpenTrades(data.max_open_trades);
        setMaxRiskPercent(Number(data.max_risk_percent));
        setMaxDailyLossPercent(Number(data.max_daily_loss_percent));
      }
    } catch (err) {
      console.error('Failed to load prop constraints:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveConstraints = async () => {
    setIsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const payload = {
        user_id: session.user.id,
        enabled,
        max_trades_per_day: maxTradesPerDay,
        max_open_trades: maxOpenTrades,
        max_risk_percent: maxRiskPercent,
        max_daily_loss_percent: maxDailyLossPercent,
      };

      const { data: existing } = await supabase
        .from('user_prop_constraints')
        .select('id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('user_prop_constraints')
          .update(payload)
          .eq('user_id', session.user.id);
      } else {
        await supabase.from('user_prop_constraints').insert(payload);
      }

      toast.success('Prop firm constraints saved');
    } catch (err) {
      toast.error('Failed to save constraints');
    } finally {
      setIsSaving(false);
    }
  };

  const isLocked = !hasFeature;

  return (
    <Card className="relative overflow-hidden">
      {isLocked && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground font-medium">Funded Trader Plan Required</p>
          <Badge variant="secondary" className="text-xs">Funded Plan</Badge>
        </div>
      )}

      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Prop Firm Compliance</CardTitle>
            <CardDescription>Automatically block signals that violate your prop firm rules</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="prop-enabled" className="font-medium">Enable Compliance Mode</Label>
              <Switch
                id="prop-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={isLocked}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max-trades">Max Trades / Day</Label>
                <Input
                  id="max-trades"
                  type="number"
                  min={1}
                  max={50}
                  value={maxTradesPerDay}
                  onChange={(e) => setMaxTradesPerDay(Number(e.target.value))}
                  disabled={isLocked || !enabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-open">Max Open Trades</Label>
                <Input
                  id="max-open"
                  type="number"
                  min={1}
                  max={20}
                  value={maxOpenTrades}
                  onChange={(e) => setMaxOpenTrades(Number(e.target.value))}
                  disabled={isLocked || !enabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-risk">Max Risk % per Trade</Label>
                <Input
                  id="max-risk"
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={maxRiskPercent}
                  onChange={(e) => setMaxRiskPercent(Number(e.target.value))}
                  disabled={isLocked || !enabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-daily-loss">Max Daily Loss %</Label>
                <Input
                  id="max-daily-loss"
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={maxDailyLossPercent}
                  onChange={(e) => setMaxDailyLossPercent(Number(e.target.value))}
                  disabled={isLocked || !enabled}
                />
              </div>
            </div>

            <Button
              onClick={saveConstraints}
              disabled={isLocked || isSaving}
              className="w-full rounded-full"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Constraints'
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};
