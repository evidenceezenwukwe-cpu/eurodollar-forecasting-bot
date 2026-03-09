import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== RULE EVALUATOR: Maps DSL rules to CRT/MSNR primitives =====

interface Candle {
  open: number; high: number; low: number; close: number; timestamp: string;
}

interface EvalContext {
  candles: Candle[];
  symbol: string;
  timeframe: string;
}

interface EvalResult {
  triggered: boolean;
  reason: string;
  details?: Record<string, any>;
}

// PRIMITIVE MAPPING TABLE
const PRIMITIVE_MAP: Record<string, string> = {
  // Trigger conditions -> CRT/MSNR checks
  "sweep_high": "checkSweepHigh",
  "sweep_low": "checkSweepLow",
  "range_sweep": "checkRangeSweep",
  "break_of_structure": "checkBOS",
  "inducement": "checkInducement",
  // Entry conditions
  "bos_bullish": "checkBullishBOS",
  "bos_bearish": "checkBearishBOS",
  "inducement_tap": "checkInducementTap",
  "fvg_entry": "checkFVGEntry",
  "order_block_entry": "checkOrderBlockEntry",
  "market_order": "alwaysTrue",
};

// ===== Primitive evaluator functions =====

function findSwingHigh(candles: Candle[], lookback: number = 5): number {
  const subset = candles.slice(-lookback);
  return Math.max(...subset.map(c => c.high));
}

function findSwingLow(candles: Candle[], lookback: number = 5): number {
  const subset = candles.slice(-lookback);
  return Math.min(...subset.map(c => c.low));
}

function checkSweepHigh(ctx: EvalContext, lookback: number = 10): EvalResult {
  if (ctx.candles.length < lookback + 1) return { triggered: false, reason: "Insufficient data" };
  
  const prevCandles = ctx.candles.slice(-(lookback + 1), -1);
  const lastCandle = ctx.candles[ctx.candles.length - 1];
  const prevHigh = Math.max(...prevCandles.map(c => c.high));
  
  // Sweep = wick above previous high but close below it
  const swept = lastCandle.high > prevHigh && lastCandle.close < prevHigh;
  return {
    triggered: swept,
    reason: swept 
      ? `Swept high at ${prevHigh.toFixed(5)} (wick: ${lastCandle.high.toFixed(5)}, close: ${lastCandle.close.toFixed(5)})` 
      : `No sweep of high ${prevHigh.toFixed(5)}`,
    details: { prevHigh, lastHigh: lastCandle.high, lastClose: lastCandle.close },
  };
}

function checkSweepLow(ctx: EvalContext, lookback: number = 10): EvalResult {
  if (ctx.candles.length < lookback + 1) return { triggered: false, reason: "Insufficient data" };
  
  const prevCandles = ctx.candles.slice(-(lookback + 1), -1);
  const lastCandle = ctx.candles[ctx.candles.length - 1];
  const prevLow = Math.min(...prevCandles.map(c => c.low));
  
  const swept = lastCandle.low < prevLow && lastCandle.close > prevLow;
  return {
    triggered: swept,
    reason: swept 
      ? `Swept low at ${prevLow.toFixed(5)} (wick: ${lastCandle.low.toFixed(5)}, close: ${lastCandle.close.toFixed(5)})`
      : `No sweep of low ${prevLow.toFixed(5)}`,
    details: { prevLow, lastLow: lastCandle.low, lastClose: lastCandle.close },
  };
}

function checkRangeSweep(ctx: EvalContext, lookback: number = 5): EvalResult {
  if (ctx.candles.length < lookback + 1) return { triggered: false, reason: "Insufficient data" };
  
  const rangeCandle = ctx.candles[ctx.candles.length - 2];
  const lastCandle = ctx.candles[ctx.candles.length - 1];
  
  const rangeHigh = rangeCandle.high;
  const rangeLow = rangeCandle.low;
  
  const sweptHigh = lastCandle.high > rangeHigh && lastCandle.close < rangeHigh;
  const sweptLow = lastCandle.low < rangeLow && lastCandle.close > rangeLow;
  
  return {
    triggered: sweptHigh || sweptLow,
    reason: sweptHigh ? `CRT range sweep high` : sweptLow ? `CRT range sweep low` : "No range sweep",
    details: { rangeHigh, rangeLow, direction: sweptHigh ? "bearish" : sweptLow ? "bullish" : "none" },
  };
}

function checkBOS(ctx: EvalContext): EvalResult {
  if (ctx.candles.length < 5) return { triggered: false, reason: "Insufficient data" };
  
  const last3 = ctx.candles.slice(-3);
  const swingLow = findSwingLow(ctx.candles.slice(-10, -3), 5);
  const swingHigh = findSwingHigh(ctx.candles.slice(-10, -3), 5);
  
  const bullishBOS = last3.some(c => c.close > swingHigh);
  const bearishBOS = last3.some(c => c.close < swingLow);
  
  return {
    triggered: bullishBOS || bearishBOS,
    reason: bullishBOS ? `Bullish BOS above ${swingHigh.toFixed(5)}` : bearishBOS ? `Bearish BOS below ${swingLow.toFixed(5)}` : "No BOS",
    details: { swingHigh, swingLow, direction: bullishBOS ? "bullish" : bearishBOS ? "bearish" : "none" },
  };
}

function checkBullishBOS(ctx: EvalContext): EvalResult {
  const result = checkBOS(ctx);
  if (result.details?.direction === "bullish") return result;
  return { triggered: false, reason: "No bullish BOS detected" };
}

function checkBearishBOS(ctx: EvalContext): EvalResult {
  const result = checkBOS(ctx);
  if (result.details?.direction === "bearish") return result;
  return { triggered: false, reason: "No bearish BOS detected" };
}

function checkInducement(ctx: EvalContext): EvalResult {
  if (ctx.candles.length < 8) return { triggered: false, reason: "Insufficient data" };
  
  // Simplified: internal liquidity grab (minor swing taken before continuation)
  const recent = ctx.candles.slice(-5);
  const prevMinorLow = Math.min(...ctx.candles.slice(-8, -5).map(c => c.low));
  const prevMinorHigh = Math.max(...ctx.candles.slice(-8, -5).map(c => c.high));
  
  const tookMinorLow = recent.some(c => c.low < prevMinorLow);
  const tookMinorHigh = recent.some(c => c.high > prevMinorHigh);
  
  return {
    triggered: tookMinorLow || tookMinorHigh,
    reason: tookMinorLow ? "Inducement: minor low taken" : tookMinorHigh ? "Inducement: minor high taken" : "No inducement",
  };
}

function checkInducementTap(ctx: EvalContext): EvalResult {
  return checkInducement(ctx);
}

function checkFVGEntry(ctx: EvalContext): EvalResult {
  if (ctx.candles.length < 3) return { triggered: false, reason: "Insufficient data" };
  
  const [c1, c2, c3] = ctx.candles.slice(-3);
  // Bullish FVG: gap between c1.high and c3.low
  const bullishFVG = c3.low > c1.high;
  // Bearish FVG: gap between c1.low and c3.high
  const bearishFVG = c3.high < c1.low;
  
  return {
    triggered: bullishFVG || bearishFVG,
    reason: bullishFVG ? "Bullish FVG detected" : bearishFVG ? "Bearish FVG detected" : "No FVG",
  };
}

function checkOrderBlockEntry(ctx: EvalContext): EvalResult {
  if (ctx.candles.length < 5) return { triggered: false, reason: "Insufficient data" };
  
  // Simplified: last bearish candle before a bullish move (demand OB)
  const recent = ctx.candles.slice(-5);
  for (let i = 0; i < recent.length - 1; i++) {
    const isBearish = recent[i].close < recent[i].open;
    const nextBullish = recent[i + 1].close > recent[i + 1].open;
    if (isBearish && nextBullish && recent[i + 1].close > recent[i].open) {
      return {
        triggered: true,
        reason: `Order block at ${recent[i].low.toFixed(5)}-${recent[i].high.toFixed(5)}`,
      };
    }
  }
  return { triggered: false, reason: "No order block pattern" };
}

// Dispatcher
function evaluateCondition(conditionName: string, ctx: EvalContext, lookback?: number): EvalResult {
  const fnMap: Record<string, (ctx: EvalContext, lb?: number) => EvalResult> = {
    checkSweepHigh, checkSweepLow, checkRangeSweep, checkBOS,
    checkBullishBOS, checkBearishBOS, checkInducement, checkInducementTap,
    checkFVGEntry, checkOrderBlockEntry,
    alwaysTrue: () => ({ triggered: true, reason: "Market order (always true)" }),
  };

  const mappedFn = PRIMITIVE_MAP[conditionName];
  if (!mappedFn || !fnMap[mappedFn]) {
    return { triggered: false, reason: `Unknown condition: ${conditionName} (no mapping found)` };
  }

  return fnMap[mappedFn](ctx, lookback);
}

// Calculate stop loss price
function calculateStop(stopConfig: any, candles: Candle[], direction: string): number | null {
  const last = candles[candles.length - 1];
  const buffer = (stopConfig.buffer_pips || 2) * 0.0001;

  switch (stopConfig.type) {
    case "swing_low":
      return findSwingLow(candles, 10) - buffer;
    case "swing_high":
      return findSwingHigh(candles, 10) + buffer;
    case "structure_low":
      return findSwingLow(candles, 5) - buffer;
    case "structure_high":
      return findSwingHigh(candles, 5) + buffer;
    case "fixed_pips":
      const pipValue = (stopConfig.value || 20) * 0.0001;
      return direction === "bullish" ? last.close - pipValue : last.close + pipValue;
    case "atr_multiple":
      // Simplified ATR calculation
      const atrCandles = candles.slice(-14);
      const atr = atrCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / atrCandles.length;
      const mult = stopConfig.value || 1.5;
      return direction === "bullish" ? last.close - (atr * mult) : last.close + (atr * mult);
    default:
      return null;
  }
}

// Calculate TP price
function calculateTP(tpConfig: any, entryPrice: number, stopPrice: number, candles: Candle[], direction: string): number | null {
  const risk = Math.abs(entryPrice - stopPrice);
  
  switch (tpConfig.type) {
    case "rr_ratio":
      return direction === "bullish" 
        ? entryPrice + (risk * tpConfig.value)
        : entryPrice - (risk * tpConfig.value);
    case "swing_target":
      return direction === "bullish" 
        ? findSwingHigh(candles, 20)
        : findSwingLow(candles, 20);
    case "fixed_pips":
      const pipValue = (tpConfig.value || 30) * 0.0001;
      return direction === "bullish" ? entryPrice + pipValue : entryPrice - pipValue;
    case "fib_extension":
      return direction === "bullish"
        ? entryPrice + (risk * (tpConfig.value || 1.618))
        : entryPrice - (risk * (tpConfig.value || 1.618));
    default:
      return null;
  }
}

// Session filter check
function isInSession(sessions: string[] | undefined): boolean {
  if (!sessions || sessions.length === 0) return true;
  
  const now = new Date();
  const utcHour = now.getUTCHours();
  
  const sessionHours: Record<string, [number, number]> = {
    asia: [0, 9],
    london: [7, 16],
    newyork: [12, 21],
  };
  
  return sessions.some(s => {
    const range = sessionHours[s];
    if (!range) return true;
    return utcHour >= range[0] && utcHour < range[1];
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch all active user strategies
    const { data: strategies, error: stratError } = await supabase
      .from('user_strategies')
      .select('*')
      .eq('active', true);

    if (stratError) throw stratError;
    if (!strategies || strategies.length === 0) {
      return new Response(JSON.stringify({ evaluated: 0, signals: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch active currency pairs
    const { data: pairs } = await supabase
      .from('supported_currency_pairs')
      .select('symbol, pip_value')
      .eq('is_active', true);

    const results: any[] = [];
    const logs: any[] = [];

    for (const strategy of strategies) {
      const rules = strategy.rules_json as any;
      if (!rules || !rules.trigger || !rules.entry) continue;

      // Check sandbox mode
      if (strategy.sandbox_mode) {
        const expiresAt = strategy.sandbox_expires_at ? new Date(strategy.sandbox_expires_at) : null;
        // Log but don't create real signals
        logs.push({ strategy_id: strategy.id, mode: 'sandbox', message: 'Running in paper mode' });
      }

      // Session filter
      if (!isInSession(rules.filters?.sessions)) {
        logs.push({ strategy_id: strategy.id, skipped: true, reason: 'Outside allowed session' });
        continue;
      }

      for (const pair of (pairs || [])) {
        try {
          // Fetch candles for trigger timeframe
          const { data: triggerCandles } = await supabase
            .from('price_history')
            .select('open, high, low, close, timestamp')
            .eq('symbol', pair.symbol)
            .eq('timeframe', rules.trigger.timeframe === '4h' ? '4h' : '1h')
            .order('timestamp', { ascending: true })
            .limit(50);

          if (!triggerCandles || triggerCandles.length < 10) continue;

          const triggerCtx: EvalContext = {
            candles: triggerCandles as Candle[],
            symbol: pair.symbol,
            timeframe: rules.trigger.timeframe,
          };

          // Evaluate trigger
          const triggerResult = evaluateCondition(
            rules.trigger.condition, triggerCtx, rules.trigger.lookback_candles
          );

          if (!triggerResult.triggered) {
            logs.push({
              strategy_id: strategy.id, symbol: pair.symbol,
              stage: 'trigger', result: triggerResult.reason,
            });
            continue;
          }

          // Fetch entry timeframe candles
          const { data: entryCandles } = await supabase
            .from('price_history')
            .select('open, high, low, close, timestamp')
            .eq('symbol', pair.symbol)
            .eq('timeframe', rules.entry.timeframe)
            .order('timestamp', { ascending: true })
            .limit(30);

          if (!entryCandles || entryCandles.length < 5) continue;

          const entryCtx: EvalContext = {
            candles: entryCandles as Candle[],
            symbol: pair.symbol,
            timeframe: rules.entry.timeframe,
          };

          const entryResult = evaluateCondition(rules.entry.condition, entryCtx);

          if (!entryResult.triggered) {
            logs.push({
              strategy_id: strategy.id, symbol: pair.symbol,
              stage: 'entry', result: entryResult.reason,
            });
            continue;
          }

          // Calculate levels
          const lastCandle = entryCandles[entryCandles.length - 1] as Candle;
          const direction = rules.entry.condition.includes('bullish') ? 'bullish' : 'bearish';
          const entryPrice = lastCandle.close;
          const stopPrice = calculateStop(rules.stop, entryCandles as Candle[], direction);
          const tp1 = stopPrice ? calculateTP(rules.tp.tp1, entryPrice, stopPrice, triggerCandles as Candle[], direction) : null;
          const tp2 = rules.tp.tp2 && stopPrice ? calculateTP(rules.tp.tp2, entryPrice, stopPrice, triggerCandles as Candle[], direction) : null;

          const signal = {
            strategy_id: strategy.id,
            user_id: strategy.user_id,
            symbol: pair.symbol,
            signal_type: direction === 'bullish' ? 'BUY' : 'SELL',
            entry_price: entryPrice,
            stop_loss: stopPrice,
            take_profit_1: tp1,
            take_profit_2: tp2,
            confidence: 70,
            trigger_reason: triggerResult.reason,
            entry_reason: entryResult.reason,
            sandbox: strategy.sandbox_mode,
            strategy_name: rules.name || strategy.name,
          };

          results.push(signal);

          // Only insert real opportunities if NOT in sandbox mode
          if (!strategy.sandbox_mode) {
            await supabase.from('trading_opportunities').insert({
              symbol: pair.symbol,
              signal_type: signal.signal_type,
              entry_price: entryPrice,
              current_price: entryPrice,
              stop_loss: stopPrice,
              take_profit_1: tp1,
              take_profit_2: tp2,
              confidence: signal.confidence,
              reasoning: `[User Strategy: ${signal.strategy_name}] Trigger: ${triggerResult.reason}. Entry: ${entryResult.reason}.`,
              expires_at: new Date(Date.now() + (rules.expiry_hours || 24) * 60 * 60 * 1000).toISOString(),
            });
          }

          logs.push({
            strategy_id: strategy.id, symbol: pair.symbol,
            stage: 'signal_generated', sandbox: strategy.sandbox_mode,
            direction, entry: entryPrice,
          });

        } catch (pairError: any) {
          logs.push({
            strategy_id: strategy.id, symbol: pair.symbol,
            error: pairError.message,
          });
        }
      }
    }

    return new Response(JSON.stringify({
      evaluated: strategies.length,
      signals: results,
      logs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error("Evaluation error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
