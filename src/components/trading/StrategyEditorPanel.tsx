import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2, Sparkles, Save, Trash2, Play, Pause, AlertTriangle,
  CheckCircle, Code, FileText, Plus, ChevronDown, ChevronUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface UserStrategy {
  id: string;
  name: string;
  description: string | null;
  rules_json: any;
  active: boolean;
  sandbox_mode: boolean;
  sandbox_expires_at: string | null;
  created_at: string;
}

const MAX_STRATEGIES = 3;

const StrategyEditorPanel = () => {
  const [strategies, setStrategies] = useState<UserStrategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedResult, setParsedResult] = useState<any>(null);
  const [editedJson, setEditedJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchStrategies = async () => {
    const { data, error } = await supabase
      .from('user_strategies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
    } else {
      setStrategies((data as any[]) || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  const handleParse = async () => {
    if (!description.trim() || description.length < 10) {
      toast.error("Please provide a more detailed strategy description (at least 10 characters)");
      return;
    }

    setIsParsing(true);
    setParsedResult(null);
    setJsonError(null);

    try {
      const { data, error } = await supabase.functions.invoke('parse-user-strategy', {
        body: { description },
      });

      if (error) throw error;

      if (data.error) {
        toast.error(data.error);
        if (data.suggestion) {
          toast.info(data.suggestion, { duration: 8000 });
        }
        setParsedResult(data);
        return;
      }

      setParsedResult(data);
      setEditedJson(JSON.stringify(data.strategy, null, 2));
      setShowJsonEditor(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to parse strategy");
    } finally {
      setIsParsing(false);
    }
  };

  const handleJsonEdit = (value: string) => {
    setEditedJson(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
    }
  };

  const handleSave = async () => {
    if (strategies.length >= MAX_STRATEGIES) {
      toast.error(`Maximum ${MAX_STRATEGIES} strategies allowed. Delete one first.`);
      return;
    }

    let rules;
    try {
      rules = JSON.parse(editedJson);
    } catch {
      toast.error("Invalid JSON - fix errors before saving");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from('user_strategies').insert({
        user_id: user.id,
        name: rules.name || "Unnamed Strategy",
        description: parsedResult?.human_summary || description,
        rules_json: rules,
        active: false,
        sandbox_mode: true,
      } as any);

      if (error) throw error;

      toast.success("Strategy saved! It starts in sandbox mode (paper trading for 7 days).");
      setDescription("");
      setParsedResult(null);
      setEditedJson("");
      setShowCreator(false);
      fetchStrategies();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    const { error } = await supabase
      .from('user_strategies')
      .update({ active: !currentActive } as any)
      .eq('id', id);

    if (error) {
      toast.error("Failed to toggle strategy");
    } else {
      toast.success(currentActive ? "Strategy deactivated" : "Strategy activated");
      fetchStrategies();
    }
  };

  const toggleSandbox = async (id: string, currentSandbox: boolean) => {
    const { error } = await supabase
      .from('user_strategies')
      .update({ sandbox_mode: !currentSandbox } as any)
      .eq('id', id);

    if (error) {
      toast.error("Failed to toggle sandbox");
    } else {
      toast.success(currentSandbox ? "Live mode enabled" : "Sandbox mode enabled");
      fetchStrategies();
    }
  };

  const deleteStrategy = async (id: string) => {
    const { error } = await supabase
      .from('user_strategies')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error("Failed to delete");
    } else {
      toast.success("Strategy deleted");
      fetchStrategies();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Custom Strategies</h3>
          <p className="text-sm text-muted-foreground">
            Define trading rules in plain English — AI converts them to executable strategies
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreator(true)}
          disabled={strategies.length >= MAX_STRATEGIES}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Strategy ({strategies.length}/{MAX_STRATEGIES})
        </Button>
      </div>

      {/* Existing strategies */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : strategies.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No custom strategies yet</p>
            <p className="text-xs mt-1">Create one by describing your trading rules in plain English</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => (
            <Card key={s.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-medium text-foreground">{s.name}</h4>
                      <Badge variant={s.active ? "default" : "secondary"}>
                        {s.active ? "Active" : "Inactive"}
                      </Badge>
                      {s.sandbox_mode && (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/50">
                          📋 Sandbox
                        </Badge>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>
                    )}
                    
                    {expandedId === s.id && (
                      <div className="mt-3">
                        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-60">
                          {JSON.stringify(s.rules_json, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    >
                      {expandedId === s.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant={s.active ? "outline" : "default"}
                      onClick={() => toggleActive(s.id, s.active)}
                    >
                      {s.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteStrategy(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {s.sandbox_mode && (
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Sandbox until {s.sandbox_expires_at ? new Date(s.sandbox_expires_at).toLocaleDateString() : '7 days'}
                    </span>
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => toggleSandbox(s.id, true)}>
                      Enable Live Mode
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Strategy Creator Dialog */}
      <Dialog open={showCreator} onOpenChange={setShowCreator}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Create Custom Strategy
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Step 1: Describe */}
            <div className="space-y-2">
              <Label>Describe your strategy in plain English</Label>
              <Textarea
                placeholder="Example: On the H4 timeframe, wait for a sweep of the previous high (liquidity grab), then drop to the M15 and enter on a bearish break of structure. Place stop loss above the swing high with 2 pip buffer. Target 1:2 risk-reward for TP1 and 1:3 for TP2. Only trade during London and New York sessions."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="text-sm"
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">{description.length}/2000 chars</span>
                <Button onClick={handleParse} disabled={isParsing || description.length < 10}>
                  {isParsing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                  Parse Strategy
                </Button>
              </div>
            </div>

            {/* Step 2: Review parsed result */}
            {parsedResult && (
              <>
                <Separator />
                
                {parsedResult.error ? (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-md p-4 space-y-2">
                    <div className="flex items-center gap-2 text-destructive font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      {parsedResult.error}
                    </div>
                    {parsedResult.validation_errors?.map((e: string, i: number) => (
                      <p key={i} className="text-sm text-muted-foreground">• {e}</p>
                    ))}
                    {parsedResult.suggestion && (
                      <p className="text-sm text-primary">{parsedResult.suggestion}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Confidence + Summary */}
                    <div className="flex items-center gap-3">
                      <Badge variant={parsedResult.confidence >= 70 ? "default" : "secondary"}>
                        {parsedResult.confidence >= 70 ? (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 mr-1" />
                        )}
                        {parsedResult.confidence}% confidence
                      </Badge>
                      {parsedResult.validation?.errors?.length > 0 && (
                        <Badge variant="destructive">
                          {parsedResult.validation.errors.length} issue(s)
                        </Badge>
                      )}
                    </div>

                    {/* Human summary */}
                    <div className="bg-muted rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Summary</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{parsedResult.human_summary}</p>
                    </div>

                    {/* Validation notes */}
                    {parsedResult.validation_notes?.length > 0 && (
                      <div className="space-y-1">
                        {parsedResult.validation_notes.map((note: string, i: number) => (
                          <p key={i} className="text-xs text-muted-foreground">ℹ️ {note}</p>
                        ))}
                      </div>
                    )}

                    {/* Validation errors */}
                    {parsedResult.validation?.errors?.length > 0 && (
                      <div className="bg-destructive/10 rounded-md p-3 space-y-1">
                        {parsedResult.validation.errors.map((e: string, i: number) => (
                          <p key={i} className="text-sm text-destructive">⚠️ {e}</p>
                        ))}
                      </div>
                    )}

                    {/* JSON Editor Toggle */}
                    <div className="flex items-center justify-between">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowJsonEditor(!showJsonEditor)}
                      >
                        <Code className="h-4 w-4 mr-1" />
                        {showJsonEditor ? "Hide" : "Edit"} JSON
                      </Button>
                    </div>

                    {showJsonEditor && (
                      <div className="space-y-2">
                        <Textarea
                          value={editedJson}
                          onChange={(e) => handleJsonEdit(e.target.value)}
                          rows={15}
                          className="font-mono text-xs"
                        />
                        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                      </div>
                    )}

                    {!showJsonEditor && (
                      <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-60">
                        {editedJson}
                      </pre>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreator(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !parsedResult?.success || !!jsonError}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Strategy (Sandbox)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StrategyEditorPanel;
