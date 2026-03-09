import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =====================================================================
// Types
// =====================================================================
interface Candle {
  timestamp: string; open: number; high: number; low: number; close: number; volume?: number;
}

interface CandidateSignal {
  symbol: string;
  signal_type: 'BUY' | 'SELL';
  confidence: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  reasoning: string;
  patterns_detected: string[];
  technical_data: any;
  source: 'global_crt' | 'user_strategy' | 'profile_preset';
  source_id: string | null;
  source_name: string;
  user_id: string | null;
  sandbox: boolean;
  created_at: string;
}

interface RunMetrics {
  strategies_run: number;
  signals_generated: number;
  signals_blocked: number;
  api_calls: number;
  symbols_scanned: number;
  details: {
    global_signals: number;
    user_signals: number;
    profile_signals: number;
    conflicts_resolved: number;
    session_filtered: number;
  };
}

type TradingSession = 'LONDON' | 'NEWYORK' | 'ASIA' | null;

// =====================================================================
// Utilities (shared with scan-opportunities)
// =====================================================================
const DEFAULT_PIP_VALUES: Record<string, number> = {
  "EUR/USD": 0.0001, "GBP/USD": 0.0001, "USD/JPY": 0.01, "USD/CHF": 0.0001,
  "AUD/USD": 0.0001, "USD/CAD": 0.0001, "EUR/JPY": 0.01, "GBP/JPY": 0.01,
  "AUD/JPY": 0.01, "XAU/USD": 0.01, "EUR/CHF": 0.0001, "EUR/GBP": 0.0001,
};

let dynamicPipValues: Record<string, number> = {};
function getPipValue(symbol: string): number {
  return dynamicPipValues[symbol] || DEFAULT_PIP_VALUES[symbol] || 0.0001;
}

function getCurrentSession(): TradingSession {
  const h = new Date().getUTCHours();
  const m = new Date().getUTCMinutes();
  const t = h * 60 + m;
  if (t >= 23 * 60 || t < 8 * 60) return 'ASIA';
  if (t >= 7 * 60 && t < 16 * 60) return 'LONDON';
  if (t >= 12 * 60 && t < 21 * 60) return 'NEWYORK';
  return null;
}

function isForexMarketOpen(): boolean {
  const now = new Date();
  const d = now.getUTCDay(), h = now.getUTCHours();
  if (d === 6) return false;
  if (d === 0 && h < 21) return false;
  if (d === 5 && h >= 21) return false;
  return true;
}

async function readCandles(supabase: any, symbol: string, timeframe: string, limit = 200): Promise<Candle[]> {
  const { data, error } = await supabase
    .from('price_history')
    .select('timestamp, open, high, low, close, volume')
    .eq('symbol', symbol).eq('timeframe', timeframe)
    .order('timestamp', { ascending: true }).limit(limit);
  if (error || !data) return [];
  return data.map((r: any) => ({
    timestamp: r.timestamp, open: Number(r.open), high: Number(r.high),
    low: Number(r.low), close: Number(r.close), volume: r.volume ? Number(r.volume) : undefined,
  }));
}

async function ensureTimeframeData(supabase: any, symbol: string, timeframe: string, metrics: RunMetrics): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  try {
    await fetch(`${supabaseUrl}/functions/v1/fetch-forex-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({ symbol, timeframe, outputsize: 200 }),
    });
    metrics.api_calls++;
  } catch (err) {
    console.error(`[${symbol}] ensureTimeframeData(${timeframe}) failed:`, err);
  }
}

// =====================================================================
// CRT Analysis (delegates to scan-opportunities via internal call)
// =====================================================================
async function runGlobalCRT(supabase: any, symbol: string, profileId: string | undefined, metrics: RunMetrics): Promise<CandidateSignal | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/scan-opportunities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({
        symbol,
        profile_id: profileId,
        dry_run: true, // Don't insert — engine handles insertion
      }),
    });
    metrics.api_calls++;
    
    const result = await resp.json().catch(() => null);
    if (!result?.opportunities?.[0]) return null;
    
    const opp = result.opportunities[0];
    return {
      symbol,
      signal_type: opp.signal_type,
      confidence: opp.confidence,
      entry_price: opp.entry_price,
      stop_loss: opp.stop_loss,
      take_profit_1: opp.take_profit_1,
      take_profit_2: opp.take_profit_2,
      reasoning: opp.reasoning || '',
      patterns_detected: opp.patterns_detected || [],
      technical_data: opp.technical_indicators || {},
      source: 'global_crt',
      source_id: profileId || null,
      source_name: 'Global CRT/MSNR',
      user_id: null,
      sandbox: false,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[${symbol}] Global CRT scan failed:`, err);
    return null;
  }
}

// =====================================================================
// User Strategy Evaluator (inline — mirrors evaluate-user-strategy logic)
// =====================================================================
function findSwingHigh(candles: Candle[], lookback = 5): number {
  return Math.max(...candles.slice(-lookback).map(c => c.high));
}
function findSwingLow(candles: Candle[], lookback = 5): number {
  return Math.min(...candles.slice(-lookback).map(c => c.low));
}

const PRIMITIVE_MAP: Record<string, string> = {
  sweep_high: "checkSweepHigh", sweep_low: "checkSweepLow", range_sweep: "checkRangeSweep",
  break_of_structure: "checkBOS", inducement: "checkInducement",
  bos_bullish: "checkBullishBOS", bos_bearish: "checkBearishBOS",
  inducement_tap: "checkInducementTap", fvg_entry: "checkFVGEntry",
  order_block_entry: "checkOrderBlockEntry", market_order: "alwaysTrue",
};

function evaluateCondition(conditionName: string, candles: Candle[], lookback?: number): { triggered: boolean; reason: string; details?: any } {
  const fnMap: Record<string, () => { triggered: boolean; reason: string; details?: any }> = {
    checkSweepHigh: () => {
      const lb = lookback || 10;
      if (candles.length < lb + 1) return { triggered: false, reason: "Insufficient data" };
      const prev = candles.slice(-(lb + 1), -1);
      const last = candles[candles.length - 1];
      const prevHigh = Math.max(...prev.map(c => c.high));
      const swept = last.high > prevHigh && last.close < prevHigh;
      return { triggered: swept, reason: swept ? `Swept high at ${prevHigh.toFixed(5)}` : `No sweep of high` };
    },
    checkSweepLow: () => {
      const lb = lookback || 10;
      if (candles.length < lb + 1) return { triggered: false, reason: "Insufficient data" };
      const prev = candles.slice(-(lb + 1), -1);
      const last = candles[candles.length - 1];
      const prevLow = Math.min(...prev.map(c => c.low));
      const swept = last.low < prevLow && last.close > prevLow;
      return { triggered: swept, reason: swept ? `Swept low at ${prevLow.toFixed(5)}` : `No sweep of low` };
    },
    checkRangeSweep: () => {
      if (candles.length < 3) return { triggered: false, reason: "Insufficient data" };
      const prev = candles[candles.length - 2];
      const last = candles[candles.length - 1];
      const sweptHigh = last.high > prev.high && last.close < prev.high;
      const sweptLow = last.low < prev.low && last.close > prev.low;
      return { triggered: sweptHigh || sweptLow, reason: sweptHigh ? "CRT range sweep high" : sweptLow ? "CRT range sweep low" : "No range sweep", details: { direction: sweptHigh ? "bearish" : sweptLow ? "bullish" : "none" } };
    },
    checkBOS: () => {
      if (candles.length < 10) return { triggered: false, reason: "Insufficient data" };
      const last3 = candles.slice(-3);
      const swLow = findSwingLow(candles.slice(-10, -3), 5);
      const swHigh = findSwingHigh(candles.slice(-10, -3), 5);
      const bull = last3.some(c => c.close > swHigh);
      const bear = last3.some(c => c.close < swLow);
      return { triggered: bull || bear, reason: bull ? `Bullish BOS above ${swHigh.toFixed(5)}` : bear ? `Bearish BOS below ${swLow.toFixed(5)}` : "No BOS", details: { direction: bull ? "bullish" : bear ? "bearish" : "none" } };
    },
    checkBullishBOS: () => { const r = fnMap.checkBOS(); return r.details?.direction === "bullish" ? r : { triggered: false, reason: "No bullish BOS" }; },
    checkBearishBOS: () => { const r = fnMap.checkBOS(); return r.details?.direction === "bearish" ? r : { triggered: false, reason: "No bearish BOS" }; },
    checkInducement: () => {
      if (candles.length < 8) return { triggered: false, reason: "Insufficient data" };
      const recent = candles.slice(-5);
      const prevLow = Math.min(...candles.slice(-8, -5).map(c => c.low));
      const prevHigh = Math.max(...candles.slice(-8, -5).map(c => c.high));
      const took = recent.some(c => c.low < prevLow) || recent.some(c => c.high > prevHigh);
      return { triggered: took, reason: took ? "Inducement taken" : "No inducement" };
    },
    checkInducementTap: () => fnMap.checkInducement(),
    checkFVGEntry: () => {
      if (candles.length < 3) return { triggered: false, reason: "Insufficient data" };
      const [c1, , c3] = candles.slice(-3);
      const bull = c3.low > c1.high;
      const bear = c3.high < c1.low;
      return { triggered: bull || bear, reason: bull ? "Bullish FVG" : bear ? "Bearish FVG" : "No FVG" };
    },
    checkOrderBlockEntry: () => {
      if (candles.length < 5) return { triggered: false, reason: "Insufficient data" };
      const recent = candles.slice(-5);
      for (let i = 0; i < recent.length - 1; i++) {
        if (recent[i].close < recent[i].open && recent[i + 1].close > recent[i + 1].open && recent[i + 1].close > recent[i].open)
          return { triggered: true, reason: `Order block at ${recent[i].low.toFixed(5)}-${recent[i].high.toFixed(5)}` };
      }
      return { triggered: false, reason: "No order block" };
    },
    alwaysTrue: () => ({ triggered: true, reason: "Market order" }),
  };

  const mapped = PRIMITIVE_MAP[conditionName];
  if (!mapped || !fnMap[mapped]) return { triggered: false, reason: `Unknown condition: ${conditionName}` };
  return fnMap[mapped]();
}

function calculateStop(stopConfig: any, candles: Candle[], direction: string, pipValue: number): number | null {
  const last = candles[candles.length - 1];
  const buf = (stopConfig.buffer_pips || 2) * pipValue;
  switch (stopConfig.type) {
    case "swing_low": return findSwingLow(candles, 10) - buf;
    case "swing_high": return findSwingHigh(candles, 10) + buf;
    case "structure_low": return findSwingLow(candles, 5) - buf;
    case "structure_high": return findSwingHigh(candles, 5) + buf;
    case "fixed_pips": { const v = (stopConfig.value || 20) * pipValue; return direction === "bullish" ? last.close - v : last.close + v; }
    case "atr_multiple": {
      const atrC = candles.slice(-14);
      const atr = atrC.reduce((s, c) => s + (c.high - c.low), 0) / atrC.length;
      const m = stopConfig.value || 1.5;
      return direction === "bullish" ? last.close - (atr * m) : last.close + (atr * m);
    }
    default: return null;
  }
}

function calculateTP(tpConfig: any, entry: number, stop: number, candles: Candle[], direction: string, pipValue: number): number | null {
  const risk = Math.abs(entry - stop);
  switch (tpConfig.type) {
    case "rr_ratio": return direction === "bullish" ? entry + risk * tpConfig.value : entry - risk * tpConfig.value;
    case "swing_target": return direction === "bullish" ? findSwingHigh(candles, 20) : findSwingLow(candles, 20);
    case "fixed_pips": { const v = (tpConfig.value || 30) * pipValue; return direction === "bullish" ? entry + v : entry - v; }
    case "fib_extension": return direction === "bullish" ? entry + risk * (tpConfig.value || 1.618) : entry - risk * (tpConfig.value || 1.618);
    default: return null;
  }
}

function isInSession(sessions: string[] | undefined): boolean {
  if (!sessions || sessions.length === 0) return true;
  const h = new Date().getUTCHours();
  const sessionHours: Record<string, [number, number]> = { asia: [0, 9], london: [7, 16], newyork: [12, 21] };
  return sessions.some(s => { const r = sessionHours[s]; if (!r) return true; return h >= r[0] && h < r[1]; });
}

async function runUserStrategy(
  supabase: any, strategy: any, symbol: string, pipValue: number, metrics: RunMetrics
): Promise<CandidateSignal | null> {
  const rules = strategy.rules_json as any;
  if (!rules?.trigger || !rules?.entry) return null;

  // Session filter from strategy DSL
  if (!isInSession(rules.filters?.sessions)) return null;

  // Fetch trigger candles
  const triggerCandles = await readCandles(supabase, symbol, rules.trigger.timeframe || '4h', 50);
  if (triggerCandles.length < 10) return null;

  const triggerResult = evaluateCondition(rules.trigger.condition, triggerCandles, rules.trigger.lookback_candles);
  if (!triggerResult.triggered) return null;

  // Fetch entry candles
  const entryCandles = await readCandles(supabase, symbol, rules.entry.timeframe || '15min', 30);
  if (entryCandles.length < 5) return null;

  const entryResult = evaluateCondition(rules.entry.condition, entryCandles);
  if (!entryResult.triggered) return null;

  const last = entryCandles[entryCandles.length - 1];
  const direction = rules.entry.condition.includes('bullish') ? 'bullish' : 'bearish';
  const entryPrice = last.close;
  const stopPrice = rules.stop ? calculateStop(rules.stop, entryCandles, direction, pipValue) : null;
  const tp1 = rules.tp?.tp1 && stopPrice ? calculateTP(rules.tp.tp1, entryPrice, stopPrice, triggerCandles, direction, pipValue) : null;
  const tp2 = rules.tp?.tp2 && stopPrice ? calculateTP(rules.tp.tp2, entryPrice, stopPrice, triggerCandles, direction, pipValue) : null;

  return {
    symbol,
    signal_type: direction === 'bullish' ? 'BUY' : 'SELL',
    confidence: 70,
    entry_price: entryPrice,
    stop_loss: stopPrice,
    take_profit_1: tp1,
    take_profit_2: tp2,
    reasoning: `[User: ${rules.name || strategy.name}] Trigger: ${triggerResult.reason}. Entry: ${entryResult.reason}.`,
    patterns_detected: [triggerResult.reason, entryResult.reason],
    technical_data: { trigger: triggerResult, entry: entryResult },
    source: 'user_strategy',
    source_id: strategy.id,
    source_name: rules.name || strategy.name,
    user_id: strategy.user_id,
    sandbox: strategy.sandbox_mode,
    created_at: new Date().toISOString(),
  };
}

// =====================================================================
// CONFLICT RESOLUTION ALGORITHM
// =====================================================================
// Priority order for same symbol:
//   1. User-specific strategy signals (highest — user opted in)
//   2. Global CRT signals (baseline)
//   3. Profile preset signals (lowest — shared templates)
//
// Within same priority tier:
//   - Higher confidence wins
//   - If confidence equal (±5%), most recent signal wins
//
// Cross-direction conflict (BUY vs SELL on same symbol):
//   - If confidence gap > 10%, higher confidence wins
//   - If confidence gap ≤ 10%, BLOCK both (ambiguous market)
// =====================================================================
const SOURCE_PRIORITY: Record<string, number> = {
  user_strategy: 3,
  global_crt: 2,
  profile_preset: 1,
};

function resolveConflicts(candidates: CandidateSignal[]): { winners: CandidateSignal[]; blocked: CandidateSignal[]; conflicts_resolved: number } {
  const bySymbol = new Map<string, CandidateSignal[]>();
  for (const c of candidates) {
    const arr = bySymbol.get(c.symbol) || [];
    arr.push(c);
    bySymbol.set(c.symbol, arr);
  }

  const winners: CandidateSignal[] = [];
  const blocked: CandidateSignal[] = [];
  let conflicts_resolved = 0;

  for (const [symbol, signals] of bySymbol) {
    if (signals.length === 1) {
      winners.push(signals[0]);
      continue;
    }

    // Group by direction
    const buys = signals.filter(s => s.signal_type === 'BUY');
    const sells = signals.filter(s => s.signal_type === 'SELL');

    if (buys.length > 0 && sells.length > 0) {
      // Cross-direction conflict
      const bestBuy = pickBest(buys);
      const bestSell = pickBest(sells);
      const gap = Math.abs(bestBuy.confidence - bestSell.confidence);

      if (gap > 10) {
        const winner = bestBuy.confidence > bestSell.confidence ? bestBuy : bestSell;
        const loser = bestBuy.confidence > bestSell.confidence ? bestSell : bestBuy;
        winners.push(winner);
        blocked.push(loser);
        conflicts_resolved++;
        console.log(`[${symbol}] Conflict resolved: ${winner.signal_type} (${winner.confidence}%) beats ${loser.signal_type} (${loser.confidence}%)`);
      } else {
        // Ambiguous — block both
        blocked.push(bestBuy, bestSell);
        conflicts_resolved++;
        console.log(`[${symbol}] Conflict blocked: BUY(${bestBuy.confidence}%) vs SELL(${bestSell.confidence}%) — gap too small`);
      }
    } else {
      // Same direction — pick best
      const best = pickBest(signals);
      winners.push(best);
      for (const s of signals) {
        if (s !== best) blocked.push(s);
      }
      if (signals.length > 1) conflicts_resolved++;
    }
  }

  return { winners, blocked, conflicts_resolved };
}

function pickBest(signals: CandidateSignal[]): CandidateSignal {
  return signals.sort((a, b) => {
    const prioDiff = (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0);
    if (prioDiff !== 0) return prioDiff;
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 5) return confDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];
}

// =====================================================================
// Session-aware scheduling for user strategies
// =====================================================================
async function getUserSessionPrefs(supabase: any, userId: string): Promise<{ allowed: boolean; session: TradingSession }> {
  const session = getCurrentSession();
  if (!session) return { allowed: true, session };

  const { data: prefs } = await supabase
    .from('user_session_preferences')
    .select('allow_london, allow_newyork, allow_asia')
    .eq('user_id', userId)
    .maybeSingle();

  if (!prefs) return { allowed: true, session };

  const map: Record<string, boolean> = { LONDON: prefs.allow_london, NEWYORK: prefs.allow_newyork, ASIA: prefs.allow_asia };
  return { allowed: map[session] ?? true, session };
}

// =====================================================================
// Prop firm validation (inline check)
// =====================================================================
async function checkPropFirm(supabase: any, userId: string | null, signal: CandidateSignal): Promise<{ allowed: boolean; reason: string }> {
  if (!userId) return { allowed: true, reason: 'no user' };

  const { data: hasFeature } = await supabase.rpc('has_feature', { _user_id: userId, _feature: 'prop_firm_compliance' });
  if (!hasFeature) return { allowed: true, reason: 'feature not enabled' };

  const { data: constraints } = await supabase
    .from('user_prop_constraints').select('*')
    .eq('user_id', userId).eq('enabled', true).maybeSingle();
  if (!constraints) return { allowed: true, reason: 'no constraints' };

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from('trading_opportunities').select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString()).in('status', ['ACTIVE', 'COMPLETED', 'CLOSED', 'EXPIRED']);
  if ((todayCount || 0) >= constraints.max_trades_per_day)
    return { allowed: false, reason: `Daily limit (${todayCount}/${constraints.max_trades_per_day})` };

  const { count: openCount } = await supabase
    .from('trading_opportunities').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE');
  if ((openCount || 0) >= constraints.max_open_trades)
    return { allowed: false, reason: `Open trades limit (${openCount}/${constraints.max_open_trades})` };

  return { allowed: true, reason: 'passed' };
}

// =====================================================================
// Main Engine
// =====================================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let hasPrivilegedRole = false;
    for (const role of ['admin', 'moderator', 'support_agent']) {
      const { data } = await supabase.rpc('has_role', {
        _user_id: authData.user.id,
        _role: role,
      });

      if (data) {
        hasPrivilegedRole = true;
        break;
      }
    }

    if (!hasPrivilegedRole) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const runMode: string = body.run_mode || 'live';
    const targetUserId: string | null = body.user_id || null;

    // Fetch-only mode: return latest run summary
    if (body.action === 'get_latest_run') {
      const { data } = await supabase
        .from('engine_run_logs').select('*')
        .order('started_at', { ascending: false }).limit(1).single();
      return new Response(JSON.stringify({ latest_run: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`=== Strategy Engine START (mode=${runMode}) ===`);
    const startTime = Date.now();

    const metrics: RunMetrics = {
      strategies_run: 0, signals_generated: 0, signals_blocked: 0, api_calls: 0, symbols_scanned: 0,
      details: { global_signals: 0, user_signals: 0, profile_signals: 0, conflicts_resolved: 0, session_filtered: 0 },
    };

    // Market check
    if (runMode === 'live' && !isForexMarketOpen()) {
      console.log("Market closed — skipping");
      return new Response(JSON.stringify({ success: true, message: "Market closed", metrics }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load active currency pairs
    const { data: pairs } = await supabase
      .from('supported_currency_pairs').select('symbol, pip_value').eq('is_active', true);
    if (!pairs || pairs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No active pairs", metrics }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    dynamicPipValues = {};
    for (const p of pairs) dynamicPipValues[p.symbol] = Number(p.pip_value);
    metrics.symbols_scanned = pairs.length;

    // Load strategies
    // 1. Global CRT profile (default or specified)
    const globalProfileId = body.profile_id as string | undefined;

    // 2. User strategies
    let userStrategiesQuery = supabase.from('user_strategies').select('*').eq('active', true);
    if (targetUserId) userStrategiesQuery = userStrategiesQuery.eq('user_id', targetUserId);
    const { data: userStrategies } = await userStrategiesQuery;

    // 3. Profile presets (shared profiles not owned by users)
    const { data: profilePresets } = await supabase
      .from('strategy_profiles').select('*').eq('shared', true);

    console.log(`Loaded: ${pairs.length} pairs, ${userStrategies?.length || 0} user strategies, ${profilePresets?.length || 0} profile presets`);

    // Expire old opportunities
    if (runMode === 'live') {
      await supabase.from('trading_opportunities')
        .update({ status: 'EXPIRED' }).eq('status', 'ACTIVE')
        .lt('expires_at', new Date().toISOString());
    }

    // ---- Run strategies per symbol with queueing ----
    const allCandidates: CandidateSignal[] = [];

    for (const pair of pairs) {
      const symbol = pair.symbol;
      const pipValue = Number(pair.pip_value);
      console.log(`\n--- ${symbol} ---`);

      // A) Global CRT strategy
      metrics.strategies_run++;
      const globalSignal = await runGlobalCRT(supabase, symbol, globalProfileId, metrics);
      if (globalSignal) {
        allCandidates.push(globalSignal);
        metrics.details.global_signals++;
      }

      // B) User strategies (with per-user session scheduling)
      if (userStrategies) {
        // Group by user to check sessions once per user
        const byUser = new Map<string, any[]>();
        for (const s of userStrategies) {
          const arr = byUser.get(s.user_id) || [];
          arr.push(s);
          byUser.set(s.user_id, arr);
        }

        for (const [userId, strategies] of byUser) {
          // Per-user session check
          const sessionCheck = await getUserSessionPrefs(supabase, userId);
          if (!sessionCheck.allowed) {
            metrics.details.session_filtered += strategies.length;
            console.log(`  [${userId.slice(0, 8)}] Session ${sessionCheck.session} blocked — skipping ${strategies.length} strategies`);
            continue;
          }

          for (const strategy of strategies) {
            metrics.strategies_run++;
            const signal = await runUserStrategy(supabase, strategy, symbol, pipValue, metrics);
            if (signal) {
              allCandidates.push(signal);
              metrics.details.user_signals++;
            }
          }
        }
      }

      // Small delay between symbols to respect API rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    // ---- Conflict Resolution ----
    const { winners, blocked, conflicts_resolved } = resolveConflicts(allCandidates);
    metrics.details.conflicts_resolved = conflicts_resolved;
    metrics.signals_blocked = blocked.length;

    console.log(`\nConflict resolution: ${allCandidates.length} candidates → ${winners.length} winners, ${blocked.length} blocked`);

    // ---- Insert winning signals ----
    const insertedOpps: any[] = [];
    for (const signal of winners) {
      // Prop firm check
      const propCheck = await checkPropFirm(supabase, signal.user_id, signal);
      if (!propCheck.allowed) {
        metrics.signals_blocked++;
        console.log(`[${signal.symbol}] Blocked by prop firm: ${propCheck.reason}`);
        if (signal.user_id) {
          await supabase.from('blocked_signals').insert({
            user_id: signal.user_id, symbol: signal.symbol, signal_type: signal.signal_type,
            block_reason: propCheck.reason, constraint_violated: 'prop_firm',
          });
        }
        continue;
      }

      // Skip sandbox signals from real insertion
      if (signal.sandbox) {
        metrics.signals_generated++;
        console.log(`[${signal.symbol}] Sandbox signal from ${signal.source_name} — not inserting`);
        continue;
      }

      // Duplicate check (4h window, 15 pip threshold)
      const { data: recentOpps } = await supabase
        .from('trading_opportunities').select('id, entry_price')
        .eq('symbol', signal.symbol).eq('signal_type', signal.signal_type)
        .gte('created_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());

      if (recentOpps?.length) {
        const pv = getPipValue(signal.symbol);
        const tooClose = recentOpps.some((o: any) => Math.abs(signal.entry_price - o.entry_price) / pv < 15);
        if (tooClose) {
          console.log(`[${signal.symbol}] Duplicate — skipping`);
          continue;
        }
      }

      // Expire conflicting opposite signals
      const opposite = signal.signal_type === 'BUY' ? 'SELL' : 'BUY';
      await supabase.from('trading_opportunities')
        .update({ status: 'EXPIRED', outcome: 'EXPIRED' })
        .eq('status', 'ACTIVE').eq('symbol', signal.symbol).eq('signal_type', opposite);

      if (runMode !== 'backtest') {
        const { data: opp, error } = await supabase.from('trading_opportunities').insert({
          symbol: signal.symbol,
          signal_type: signal.signal_type,
          confidence: signal.confidence,
          entry_price: signal.entry_price,
          current_price: signal.entry_price,
          stop_loss: signal.stop_loss,
          take_profit_1: signal.take_profit_1,
          take_profit_2: signal.take_profit_2,
          patterns_detected: signal.patterns_detected,
          technical_indicators: signal.technical_data,
          reasoning: signal.reasoning,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        }).select().single();

        if (!error && opp) {
          insertedOpps.push(opp);
          metrics.signals_generated++;

          // Telegram notification
          try {
            const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
            await fetch(`${supabaseUrl}/functions/v1/send-telegram-notification`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
              body: JSON.stringify({
                symbol: signal.symbol, signal_type: signal.signal_type,
                confidence: signal.confidence, entry_price: signal.entry_price,
                stop_loss: signal.stop_loss, take_profit_1: signal.take_profit_1,
                take_profit_2: signal.take_profit_2,
                reasoning: `[Engine: ${signal.source_name}] ${signal.reasoning}`,
              }),
            });
          } catch (e) { console.error("Telegram failed:", e); }
        }
      } else {
        metrics.signals_generated++;
      }
    }

    // ---- Log run ----
    const elapsed = Date.now() - startTime;
    await supabase.from('engine_run_logs').insert({
      run_mode: runMode,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      strategies_run: metrics.strategies_run,
      signals_generated: metrics.signals_generated,
      signals_blocked: metrics.signals_blocked,
      api_calls: metrics.api_calls,
      symbols_scanned: metrics.symbols_scanned,
      details: metrics.details,
    });

    console.log(`\n=== Engine DONE in ${elapsed}ms | ${metrics.signals_generated} signals, ${metrics.signals_blocked} blocked ===`);

    return new Response(JSON.stringify({
      success: true,
      run_mode: runMode,
      elapsed_ms: elapsed,
      metrics,
      opportunities: insertedOpps,
      blocked: blocked.map(b => ({ symbol: b.symbol, signal_type: b.signal_type, source: b.source_name, confidence: b.confidence })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error("Engine error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
