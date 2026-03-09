import { memo, useEffect, useState, useMemo } from 'react';
import { BarChart3, ArrowUpDown, TrendingUp, TrendingDown, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface PatternMetric {
  id: string;
  pattern_name: string;
  symbol: string;
  timeframe: string;
  session: string;
  trades_count: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_rr: number;
  profit_factor: number;
  avg_pips: number;
  recent_results: { outcome: string; pips: number; date: string }[] | null;
  last_updated: string;
}

type SortKey = 'pattern_name' | 'trades_count' | 'win_rate' | 'profit_factor' | 'avg_pips' | 'avg_rr';

function Sparkline({ results }: { results: { outcome: string; pips: number }[] }) {
  if (!results || results.length === 0) return <span className="text-muted-foreground text-xs">—</span>;

  const reversed = [...results].reverse(); // oldest first
  const width = 60;
  const height = 20;
  const step = width / Math.max(reversed.length - 1, 1);

  // Normalize
  const values = reversed.map(r => r.pips);
  const max = Math.max(...values.map(Math.abs), 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height / 2 - (v / max) * (height / 2 - 2);
    return `${x},${y}`;
  }).join(' ');

  const lastOutcome = reversed[reversed.length - 1]?.outcome;
  const color = lastOutcome === 'WIN' ? 'hsl(var(--bullish))' : 'hsl(var(--bearish))';

  return (
    <svg width={width} height={height} className="inline-block">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="hsl(var(--border))" strokeWidth="0.5" />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

export const AdvancedPatternStats = memo(function AdvancedPatternStats({
  className,
}: { className?: string }) {
  const [metrics, setMetrics] = useState<PatternMetric[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('win_rate');
  const [sortAsc, setSortAsc] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<string>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('all');

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('pattern_metrics')
        .select('*')
        .gte('trades_count', 1)
        .order('win_rate', { ascending: false });

      if (!error && data) {
        setMetrics(data as unknown as PatternMetric[]);
      }
      setIsLoading(false);
    }
    load();
  }, []);

  const symbols = useMemo(() => {
    const set = new Set(metrics.map(m => m.symbol));
    return Array.from(set).sort();
  }, [metrics]);

  const filtered = useMemo(() => {
    let result = metrics.filter(m => m.session === sessionFilter);
    if (symbolFilter !== 'all') result = result.filter(m => m.symbol === symbolFilter);
    result.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      if (typeof av === 'string') return sortAsc ? (av as string).localeCompare(bv as unknown as string) : (bv as unknown as string).localeCompare(av as string);
      return sortAsc ? av - bv : bv - av;
    });
    return result;
  }, [metrics, sessionFilter, symbolFilter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const formatName = (n: string) =>
    n.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (isLoading) {
    return (
      <div className={cn('trading-card p-4', className)}>
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4" /> Advanced Pattern Metrics
        </h3>
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted rounded" />)}
        </div>
      </div>
    );
  }

  if (metrics.length === 0) {
    return (
      <div className={cn('trading-card p-4', className)}>
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4" /> Advanced Pattern Metrics
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">
          No metrics available yet. Metrics are computed from evaluated trade outcomes.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('trading-card p-4', className)}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Advanced Pattern Metrics
        </h3>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={sessionFilter} onValueChange={setSessionFilter}>
            <SelectTrigger className="h-7 text-xs w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Sessions</SelectItem>
              <SelectItem value="LONDON">London</SelectItem>
              <SelectItem value="NEWYORK">New York</SelectItem>
              <SelectItem value="ASIA">Asia</SelectItem>
            </SelectContent>
          </Select>
          {symbols.length > 1 && (
            <Select value={symbolFilter} onValueChange={setSymbolFilter}>
              <SelectTrigger className="h-7 text-xs w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Pairs</SelectItem>
                {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[400px] overflow-y-auto scrollbar-thin">
        <Table>
          <TableHeader>
            <TableRow>
              {([
                ['pattern_name', 'Pattern'],
                ['trades_count', 'Trades'],
                ['win_rate', 'Win %'],
                ['profit_factor', 'PF'],
                ['avg_pips', 'Avg Pips'],
                ['avg_rr', 'Avg RR'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <TableHead
                  key={key}
                  className="cursor-pointer select-none text-xs whitespace-nowrap"
                  onClick={() => toggleSort(key)}
                >
                  <span className="flex items-center gap-1">
                    {label}
                    {sortKey === key && <ArrowUpDown className="h-3 w-3" />}
                  </span>
                </TableHead>
              ))}
              <TableHead className="text-xs">Last 10</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(m => (
              <TableRow key={m.id}>
                <TableCell className="text-xs font-medium whitespace-nowrap">
                  {formatName(m.pattern_name)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{m.trades_count}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs',
                      m.win_rate >= 55 ? 'border-bullish/40 text-bullish' :
                      m.win_rate >= 45 ? 'border-neutral/40 text-neutral' :
                      'border-bearish/40 text-bearish'
                    )}
                  >
                    {m.win_rate.toFixed(1)}%
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <span className={cn(
                    m.profit_factor >= 1.5 ? 'text-bullish' :
                    m.profit_factor >= 1 ? 'text-foreground' :
                    'text-bearish'
                  )}>
                    {m.profit_factor.toFixed(2)}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  <span className={cn(
                    'flex items-center gap-1',
                    m.avg_pips >= 0 ? 'text-bullish' : 'text-bearish'
                  )}>
                    {m.avg_pips >= 0
                      ? <TrendingUp className="h-3 w-3" />
                      : <TrendingDown className="h-3 w-3" />}
                    {m.avg_pips.toFixed(1)}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{m.avg_rr.toFixed(2)}</TableCell>
                <TableCell>
                  <Sparkline results={(m.recent_results as { outcome: string; pips: number }[]) || []} />
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                  No data for selected filters
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[10px] text-muted-foreground mt-2">
        Updated: {metrics[0]?.last_updated ? new Date(metrics[0].last_updated).toLocaleString() : '—'}
        {' · '}{filtered.length} patterns
      </p>
    </div>
  );
});
