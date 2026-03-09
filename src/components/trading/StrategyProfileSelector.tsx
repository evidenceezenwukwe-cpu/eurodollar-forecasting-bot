import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Settings2 } from 'lucide-react';
import { StrategyProfile, formatTFLabel } from '@/hooks/useStrategyProfiles';

interface StrategyProfileSelectorProps {
  profiles: StrategyProfile[];
  activeProfileId: string | null;
  onSelect: (profileId: string) => void;
  isLoading?: boolean;
}

export function StrategyProfileSelector({
  profiles,
  activeProfileId,
  onSelect,
  isLoading,
}: StrategyProfileSelectorProps) {
  const activeProfile = profiles.find(p => p.id === activeProfileId);

  if (isLoading || profiles.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Strategy</span>
      </div>
      <Select value={activeProfileId || ''} onValueChange={onSelect}>
        <SelectTrigger className="w-full bg-card border-border">
          <SelectValue placeholder="Select strategy..." />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              <div className="flex items-center gap-2">
                <span>{profile.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTFLabel(profile.htf)} → {formatTFLabel(profile.trigger_tf)} → {formatTFLabel(profile.entry_tf)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeProfile && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-xs">
            HTF: {formatTFLabel(activeProfile.htf)}
          </Badge>
          <span className="text-muted-foreground text-xs">→</span>
          <Badge variant="outline" className="text-xs">
            Trigger: {formatTFLabel(activeProfile.trigger_tf)}
          </Badge>
          <span className="text-muted-foreground text-xs">→</span>
          <Badge variant="outline" className="text-xs">
            Entry: {formatTFLabel(activeProfile.entry_tf)}
          </Badge>
        </div>
      )}
    </div>
  );
}
