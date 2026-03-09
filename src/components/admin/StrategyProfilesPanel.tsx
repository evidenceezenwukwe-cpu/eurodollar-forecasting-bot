import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatTFLabel } from '@/hooks/useStrategyProfiles';

interface Profile {
  id: string;
  name: string;
  htf: string;
  trigger_tf: string;
  entry_tf: string;
  settings: Record<string, any> | null;
  shared: boolean;
}

const TIMEFRAMES = ['1w', '1d', '4h', '1h', '30min', '15min', '5min', '1min'];

export default function StrategyProfilesPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newHtf, setNewHtf] = useState('1d');
  const [newTrigger, setNewTrigger] = useState('4h');
  const [newEntry, setNewEntry] = useState('15min');

  const fetchProfiles = async () => {
    const { data, error } = await supabase
      .from('strategy_profiles')
      .select('*')
      .eq('shared', true)
      .order('name');

    if (!error && data) {
      setProfiles(data as unknown as Profile[]);
    }
    setIsLoading(false);
  };

  useEffect(() => { fetchProfiles(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Profile name is required');
      return;
    }

    const { error } = await supabase.from('strategy_profiles').insert({
      name: newName.trim(),
      htf: newHtf,
      trigger_tf: newTrigger,
      entry_tf: newEntry,
      shared: true,
      user_id: null,
    });

    if (error) {
      toast.error('Failed to create profile');
      return;
    }

    toast.success('Profile created');
    setNewName('');
    fetchProfiles();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('strategy_profiles').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete profile');
      return;
    }
    toast.success('Profile deleted');
    fetchProfiles();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          Strategy Profiles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Existing profiles */}
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shared profiles</p>
          ) : (
            profiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div className="space-y-1">
                  <p className="font-medium">{p.name}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-xs">HTF: {formatTFLabel(p.htf)}</Badge>
                    <span className="text-muted-foreground text-xs">→</span>
                    <Badge variant="outline" className="text-xs">Trigger: {formatTFLabel(p.trigger_tf)}</Badge>
                    <span className="text-muted-foreground text-xs">→</span>
                    <Badge variant="outline" className="text-xs">Entry: {formatTFLabel(p.entry_tf)}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Create new */}
        <div className="border-t border-border pt-4 space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" /> New Global Preset
          </h4>
          <div>
            <Label>Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Custom Scalp" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>HTF</Label>
              <Select value={newHtf} onValueChange={setNewHtf}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map(tf => (
                    <SelectItem key={tf} value={tf}>{formatTFLabel(tf)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Trigger</Label>
              <Select value={newTrigger} onValueChange={setNewTrigger}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map(tf => (
                    <SelectItem key={tf} value={tf}>{formatTFLabel(tf)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entry</Label>
              <Select value={newEntry} onValueChange={setNewEntry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map(tf => (
                    <SelectItem key={tf} value={tf}>{formatTFLabel(tf)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleCreate} className="w-full">Create Preset</Button>
        </div>
      </CardContent>
    </Card>
  );
}
