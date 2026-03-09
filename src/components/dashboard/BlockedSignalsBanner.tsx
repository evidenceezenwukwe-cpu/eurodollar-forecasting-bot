import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface BlockedSignal {
  id: string;
  symbol: string;
  signal_type: string;
  block_reason: string;
  constraint_violated: string;
  created_at: string;
}

export const BlockedSignalsBanner = () => {
  const [blocks, setBlocks] = useState<BlockedSignal[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRecentBlocks();
  }, []);

  const loadRecentBlocks = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('blocked_signals')
      .select('id, symbol, signal_type, block_reason, constraint_violated, created_at')
      .eq('user_id', session.user.id)
      .gte('created_at', sixHoursAgo)
      .order('created_at', { ascending: false })
      .limit(5);

    if (data) setBlocks(data);
  };

  const visibleBlocks = blocks.filter(b => !dismissed.has(b.id));

  if (visibleBlocks.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visibleBlocks.map((block) => (
        <div
          key={block.id}
          className="flex items-center justify-between gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5"
        >
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                <Badge variant="outline" className="mr-2 text-xs">
                  {block.symbol}
                </Badge>
                {block.block_reason}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(block.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(prev => new Set(prev).add(block.id))}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
