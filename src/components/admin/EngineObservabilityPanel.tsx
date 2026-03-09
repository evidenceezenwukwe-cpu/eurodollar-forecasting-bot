import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Play, Clock, AlertTriangle, BarChart3, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EngineRunLog {
  id: string;
  run_mode: string;
  started_at: string;
  completed_at: string | null;
  strategies_run: number;
  signals_generated: number;
  signals_blocked: number;
  api_calls: number;
  symbols_scanned: number;
  details: any;
  error: string | null;
}

const EngineObservabilityPanel = () => {
  const [logs, setLogs] = useState<EngineRunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [runMode, setRunMode] = useState<string>("live");
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("engine_run_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);
    setLogs((data as EngineRunLog[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const triggerRun = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("strategy-engine", {
        body: { run_mode: runMode },
      });
      if (error) throw error;
      toast({
        title: "Engine run complete",
        description: `${data.metrics?.signals_generated || 0} signals generated, ${data.metrics?.signals_blocked || 0} blocked`,
      });
      fetchLogs();
    } catch (err: any) {
      toast({ title: "Engine run failed", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return "—";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  };

  const latestRun = logs[0];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Strategy Engine
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={runMode} onValueChange={setRunMode}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="paper">Paper</SelectItem>
                <SelectItem value="backtest">Backtest</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={triggerRun} disabled={running}>
              <Play className="h-4 w-4 mr-2" />
              {running ? "Running…" : "Run Engine"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Latest Run Summary */}
      {latestRun && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-foreground">{latestRun.strategies_run}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="h-3 w-3" />Strategies Run</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-500">{latestRun.signals_generated}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" />Signals Generated</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-500">{latestRun.signals_blocked}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Blocked</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-foreground">{latestRun.api_calls}</div>
              <p className="text-xs text-muted-foreground">API Calls</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-foreground">{formatDuration(latestRun.started_at, latestRun.completed_at)}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Duration</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Run History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No runs yet</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant={log.error ? "destructive" : "secondary"}>
                      {log.run_mode}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(log.started_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span>{log.symbols_scanned} pairs</span>
                    <span className="text-green-500">{log.signals_generated} signals</span>
                    <span className="text-red-500">{log.signals_blocked} blocked</span>
                    <span className="text-muted-foreground">{formatDuration(log.started_at, log.completed_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EngineObservabilityPanel;
