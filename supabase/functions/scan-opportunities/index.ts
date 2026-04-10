import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// =====================================================================
// Strategy Profile Types & Defaults
// =====================================================================
interface StrategyProfile {
  id?: string;
  name: string;
  htf: string;
  trigger_tf: string;
  entry_tf: string;
  settings: Record<string, any>;
}

const DEFAULT_PROFILE: StrategyProfile = {
  name: 'Swing (Default)',
  htf: '1d',
  trigger_tf: '4h',
  entry_tf: '15min',
  settings: {},
};

// =====================================================================
// Pair+Direction Blocklist — sub-50% win rate combos disabled
// =====================================================================
const BLOCKED_PAIR_DIRECTIONS: Record<string, string[]> = {
  'XAU/USD': ['BUY'],
  'EUR/GBP': ['SELL'],
  'USD/CHF': ['BUY'],
  'AUD/JPY': ['BUY'],
  'EUR/JPY': ['SELL'],
};

// Strong pair+direction combos for confidence bonus
const STRONG_PAIR_DIRECTIONS: Record<string, string[]> = {
  'EUR/USD': ['BUY'],
  'USD/JPY': ['SELL'],
  'GBP/USD': ['SELL'],
  'USD/CAD': ['SELL'],
};

// Max entry distance in pips per pair type
const MAX_ENTRY_DISTANCE_PIPS: Record<string, number> = {
  'XAU/USD': 300,
  'USD/JPY': 80,
  'EUR/JPY': 80,
  'GBP/JPY': 80,
  'AUD/JPY': 80,
  // All other pairs default to 50
};

function getMaxEntryDistancePips(symbol: string): number {
  return MAX_ENTRY_DISTANCE_PIPS[symbol] || 50;
}

function isBlockedPairDirection(symbol: string, direction: string): boolean {
  const blocked = BLOCKED_PAIR_DIRECTIONS[symbol];
  return blocked ? blocked.includes(direction) : false;
}

function isStrongPairDirection(symbol: string, direction: string): boolean {
  const strong = STRONG_PAIR_DIRECTIONS[symbol];
  return strong ? strong.includes(direction) : false;
}

async function resolveProfile(supabase: any, profileId?: string): Promise<StrategyProfile> {
  if (!profileId) return DEFAULT_PROFILE;

  try {
    const { data, error } = await supabase
      .from('strategy_profiles')
      .select('id, name, htf, trigger_tf, entry_tf, settings')
      .eq('id', profileId)
      .single();

    if (error || !data) {
      console.log(`Profile ${profileId} not found, using default`);
      return DEFAULT_PROFILE;
    }

    console.log(`Resolved strategy profile: "${data.name}" (HTF=${data.htf}, Trigger=${data.trigger_tf}, Entry=${data.entry_tf})`);
    return {
      id: data.id,
      name: data.name,
      htf: data.htf,
      trigger_tf: data.trigger_tf,
      entry_tf: data.entry_tf,
      settings: data.settings || {},
    };
  } catch {
    console.error('Failed to resolve profile, using default');
    return DEFAULT_PROFILE;
  }
}

// Default pip values (overridden by database values when available)
const DEFAULT_PIP_VALUES: Record<string, number> = {
  "EUR/USD": 0.0001,
  "GBP/USD": 0.0001,
  "USD/JPY": 0.01,
  "USD/CHF": 0.0001,
  "AUD/USD": 0.0001,
  "USD/CAD": 0.0001,
  "EUR/JPY": 0.01,
  "GBP/JPY": 0.01,
  "AUD/JPY": 0.01,
  "XAU/USD": 0.01,
  "EUR/CHF": 0.0001,
  "EUR/GBP": 0.0001,
};

interface CurrencyPairConfig {
  symbol: string;
  pip_value: number;
}

let dynamicPipValues: Record<string, number> = {};

function getPipValue(symbol: string): number {
  return dynamicPipValues[symbol] || DEFAULT_PIP_VALUES[symbol] || 0.0001;
}

async function getActiveCurrencyPairs(supabase: any): Promise<CurrencyPairConfig[]> {
  const { data, error } = await supabase
    .from('supported_currency_pairs')
    .select('symbol, pip_value')
    .eq('is_active', true);

  if (error) {
    console.error('Failed to fetch currency pairs:', error);
    return [];
  }

  dynamicPipValues = {};
  for (const pair of data || []) {
    dynamicPipValues[pair.symbol] = Number(pair.pip_value);
  }

  console.log(`Loaded ${data?.length || 0} active currency pairs from database`);
  return data || [];
}

function isForexMarketOpen(): { isOpen: boolean; reason: string } {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();

  if (utcDay === 6) return { isOpen: false, reason: "Forex market is closed on Saturdays" };
  if (utcDay === 0 && utcHour < 21) return { isOpen: false, reason: "Forex market opens Sunday 21:00 UTC" };
  if (utcDay === 5 && utcHour >= 21) return { isOpen: false, reason: "Forex market closed Friday 21:00 UTC" };

  return { isOpen: true, reason: "Market is open" };
}

// =====================================================================
// Session Timing Utilities
// =====================================================================
type TradingSession = 'LONDON' | 'NEWYORK' | 'ASIA' | null;

function getCurrentSession(): TradingSession {
  const now = new Date();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const t = h * 60 + m; // minutes since midnight UTC

  // Asia: 23:00 – 08:00 UTC (wraps midnight)
  if (t >= 23 * 60 || t < 8 * 60) return 'ASIA';
  // London: 07:00 – 16:00 UTC
  if (t >= 7 * 60 && t < 16 * 60) return 'LONDON';
  // New York: 12:00 – 21:00 UTC
  if (t >= 12 * 60 && t < 21 * 60) return 'NEWYORK';

  return null;
}

async function isSessionAllowed(supabase: any, userId: string | undefined): Promise<{ allowed: boolean; session: TradingSession; reason: string }> {
  const session = getCurrentSession();

  if (!userId || !session) {
    return { allowed: true, session, reason: 'No user context or no active session' };
  }

  // Check if user has the session_filters feature
  const { data: hasFeature } = await supabase.rpc('has_feature', { _user_id: userId, _feature: 'session_filters' });

  if (!hasFeature) {
    return { allowed: true, session, reason: 'User does not have session_filters feature' };
  }

  // Load preferences
  const { data: prefs, error } = await supabase
    .from('user_session_preferences')
    .select('allow_london, allow_newyork, allow_asia')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !prefs) {
    // No preferences set = all sessions allowed (default)
    return { allowed: true, session, reason: 'No session preferences configured' };
  }

  const sessionMap: Record<string, boolean> = {
    LONDON: prefs.allow_london,
    NEWYORK: prefs.allow_newyork,
    ASIA: prefs.allow_asia,
  };

  const allowed = sessionMap[session] ?? true;
  return {
    allowed,
    session,
    reason: allowed ? `Session ${session} is allowed` : `Session ${session} is blocked by user preference`,
  };
}

// =====================================================================
// Candle type
// =====================================================================
interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// =====================================================================
// Step 0: Ensure timeframe data is cached via fetch-forex-data
// =====================================================================
async function ensureTimeframeData(supabase: any, symbol: string, timeframe: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/fetch-forex-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ symbol, timeframe, outputsize: timeframe === '1d' ? 60 : 150 }),
    });
    const result = await resp.json().catch(() => ({}));
    console.log(`[${symbol}] ensureTimeframeData(${timeframe}): success=${result?.success}, source=${result?.meta?.source || 'api'}`);
  } catch (err) {
    console.error(`[${symbol}] ensureTimeframeData(${timeframe}) failed:`, err);
  }
}

// =====================================================================
// Read cached candles from price_history
// =====================================================================
async function readCandles(supabase: any, symbol: string, timeframe: string, limit = 200): Promise<Candle[]> {
  const { data, error } = await supabase
    .from('price_history')
    .select('timestamp, open, high, low, close, volume')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('timestamp', { ascending: true })
    .limit(limit);

  if (error || !data) {
    console.error(`[${symbol}] readCandles(${timeframe}) error:`, error);
    return [];
  }

  return data.map((r: any) => ({
    timestamp: r.timestamp,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume === null ? undefined : Number(r.volume),
  }));
}

// =====================================================================
// Aggregate 4h candles into synthetic daily candles
// =====================================================================
function aggregate4hToDaily(h4Candles: Candle[]): Candle[] {
  if (h4Candles.length === 0) return [];

  const dayMap = new Map<string, Candle[]>();
  for (const c of h4Candles) {
    const key = c.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(c);
  }

  const daily: Candle[] = [];
  for (const [, candles] of dayMap) {
    if (candles.length < 2) continue; // skip incomplete days
    daily.push({
      timestamp: candles[0].timestamp,
      open: candles[0].open,
      high: Math.max(...candles.map(c => c.high)),
      low: Math.min(...candles.map(c => c.low)),
      close: candles[candles.length - 1].close,
    });
  }

  return daily.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// =====================================================================
// Aggregate daily candles into weekly candles
// =====================================================================
function aggregateWeeklyCandles(dailyCandles: Candle[]): Candle[] {
  if (dailyCandles.length === 0) return [];

  const weekMap = new Map<string, Candle[]>();

  for (const c of dailyCandles) {
    const d = new Date(c.timestamp);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const dayIndex = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
    const weekNum = Math.ceil((dayIndex + jan1.getDay() + 1) / 7);
    const key = `${d.getFullYear()}-W${weekNum}`;

    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(c);
  }

  const weekly: Candle[] = [];
  for (const [, candles] of weekMap) {
    if (candles.length === 0) continue;
    weekly.push({
      timestamp: candles[0].timestamp,
      open: candles[0].open,
      high: Math.max(...candles.map(c => c.high)),
      low: Math.min(...candles.map(c => c.low)),
      close: candles[candles.length - 1].close,
    });
  }

  return weekly.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// =====================================================================
// Calculate Support/Resistance levels from candles (pivot-based)
// =====================================================================
function calculateSR(candles: Candle[]): { support: number[]; resistance: number[] } {
  const support: number[] = [];
  const resistance: number[] = [];

  const lookback = Math.min(50, candles.length);
  const recent = candles.slice(-lookback);

  for (let i = 2; i < recent.length - 2; i++) {
    // Swing high
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
        recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high) {
      resistance.push(recent[i].high);
    }
    // Swing low
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
        recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low) {
      support.push(recent[i].low);
    }
  }

  return {
    support: support.sort((a, b) => b - a).slice(0, 5),
    resistance: resistance.sort((a, b) => a - b).slice(0, 5),
  };
}

// =====================================================================
// Step A: Higher Timeframe Bias Detection (Weekly / Daily)
// =====================================================================
interface HTFBias {
  bias: 'BULLISH' | 'BEARISH';
  rejectionLevel: number;
  rejectionTimeframe: 'Weekly' | 'Daily';
  keyLevel: number;
}

function detectCandleRejection(candles: Candle[], direction: 'high' | 'low', lookback = 5): {
  found: boolean;
  rejectionLevel: number;
  candleIndex: number;
} {
  if (candles.length < 3) return { found: false, rejectionLevel: 0, candleIndex: -1 };

  const end = candles.length - 1;
  const start = Math.max(1, end - lookback);

  for (let i = end; i >= start; i--) {
    const curr = candles[i];
    const prev = candles[i - 1];

    if (direction === 'high') {
      // Bearish rejection: swept previous high but closed below it
      if (curr.high > prev.high && curr.close < prev.high) {
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const body = Math.abs(curr.close - curr.open);
        // Rejection wick should be meaningful (at least as large as body)
        if (upperWick >= body * 0.5) {
          return { found: true, rejectionLevel: curr.high, candleIndex: i };
        }
      }
    } else {
      // Bullish rejection: swept previous low but closed above it
      if (curr.low < prev.low && curr.close > prev.low) {
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        const body = Math.abs(curr.close - curr.open);
        if (lowerWick >= body * 0.5) {
          return { found: true, rejectionLevel: curr.low, candleIndex: i };
        }
      }
    }
  }

  return { found: false, rejectionLevel: 0, candleIndex: -1 };
}

function detectHTFBias(weeklyCandles: Candle[], dailyCandles: Candle[], dailySR: { support: number[]; resistance: number[] }): HTFBias | null {
  // Check weekly first for stronger bias
  const weeklyBearish = detectCandleRejection(weeklyCandles, 'high', 3);
  if (weeklyBearish.found) {
    // Verify rejection is near a resistance level
    const nearResistance = dailySR.resistance.some(r => Math.abs(weeklyBearish.rejectionLevel - r) / r < 0.005);
    if (nearResistance || dailySR.resistance.length === 0) {
      console.log(`  HTF Bias: BEARISH (Weekly rejection at ${weeklyBearish.rejectionLevel})`);
      return {
        bias: 'BEARISH',
        rejectionLevel: weeklyBearish.rejectionLevel,
        rejectionTimeframe: 'Weekly',
        keyLevel: dailySR.resistance[0] || weeklyBearish.rejectionLevel,
      };
    }
  }

  const weeklyBullish = detectCandleRejection(weeklyCandles, 'low', 3);
  if (weeklyBullish.found) {
    const nearSupport = dailySR.support.some(s => Math.abs(weeklyBullish.rejectionLevel - s) / s < 0.005);
    if (nearSupport || dailySR.support.length === 0) {
      console.log(`  HTF Bias: BULLISH (Weekly rejection at ${weeklyBullish.rejectionLevel})`);
      return {
        bias: 'BULLISH',
        rejectionLevel: weeklyBullish.rejectionLevel,
        rejectionTimeframe: 'Weekly',
        keyLevel: dailySR.support[0] || weeklyBullish.rejectionLevel,
      };
    }
  }

  // Fall back to daily
  const dailyBearish = detectCandleRejection(dailyCandles, 'high', 5);
  if (dailyBearish.found) {
    console.log(`  HTF Bias: BEARISH (Daily rejection at ${dailyBearish.rejectionLevel})`);
    return {
      bias: 'BEARISH',
      rejectionLevel: dailyBearish.rejectionLevel,
      rejectionTimeframe: 'Daily',
      keyLevel: dailySR.resistance[0] || dailyBearish.rejectionLevel,
    };
  }

  const dailyBullish = detectCandleRejection(dailyCandles, 'low', 5);
  if (dailyBullish.found) {
    console.log(`  HTF Bias: BULLISH (Daily rejection at ${dailyBullish.rejectionLevel})`);
    return {
      bias: 'BULLISH',
      rejectionLevel: dailyBullish.rejectionLevel,
      rejectionTimeframe: 'Daily',
      keyLevel: dailySR.support[0] || dailyBullish.rejectionLevel,
    };
  }

  return null;
}

// =====================================================================
// Step B: H4 Candle Range Theory (CRT) Sweep Detection
// =====================================================================
interface H4Sweep {
  swept: boolean;
  h4RangeHigh: number;
  h4RangeLow: number;
  sweepCandle: Candle;
  previousH4: Candle;
}

function detectH4Sweep(h4Candles: Candle[], bias: 'BULLISH' | 'BEARISH'): H4Sweep | null {
  if (h4Candles.length < 3) return null;

  // Previous closed H4 candle (second to last) defines the range
  const prevH4 = h4Candles[h4Candles.length - 2];
  const currentH4 = h4Candles[h4Candles.length - 1];

  const h4RangeHigh = prevH4.high;
  const h4RangeLow = prevH4.low;

  if (bias === 'BEARISH') {
    // For SELL: current H4 must sweep ABOVE previous H4 high
    if (currentH4.high > h4RangeHigh) {
      console.log(`  H4 Sweep: BEARISH confirmed (High ${currentH4.high} > Range High ${h4RangeHigh})`);
      return { swept: true, h4RangeHigh, h4RangeLow, sweepCandle: currentH4, previousH4: prevH4 };
    }
    // Also check the candle before current (the sweep may have just completed)
    if (h4Candles.length >= 4) {
      const thirdH4 = h4Candles[h4Candles.length - 3];
      const range2 = thirdH4;
      if (prevH4.high > range2.high) {
        console.log(`  H4 Sweep: BEARISH confirmed (prev H4 High ${prevH4.high} > Range High ${range2.high})`);
        return { swept: true, h4RangeHigh: range2.high, h4RangeLow: range2.low, sweepCandle: prevH4, previousH4: range2 };
      }
    }
  } else {
    // For BUY: current H4 must sweep BELOW previous H4 low
    if (currentH4.low < h4RangeLow) {
      console.log(`  H4 Sweep: BULLISH confirmed (Low ${currentH4.low} < Range Low ${h4RangeLow})`);
      return { swept: true, h4RangeHigh, h4RangeLow, sweepCandle: currentH4, previousH4: prevH4 };
    }
    if (h4Candles.length >= 4) {
      const thirdH4 = h4Candles[h4Candles.length - 3];
      const range2 = thirdH4;
      if (prevH4.low < range2.low) {
        console.log(`  H4 Sweep: BULLISH confirmed (prev H4 Low ${prevH4.low} < Range Low ${range2.low})`);
        return { swept: true, h4RangeHigh: range2.high, h4RangeLow: range2.low, sweepCandle: prevH4, previousH4: range2 };
      }
    }
  }

  return null;
}

// =====================================================================
// Step C: M15 Execution — MSNR Model 1 (BOS + Inducement)
// =====================================================================
interface M15Entry {
  valid: boolean;
  entryPrice: number;
  stopLoss: number;
  bosLevel: number;
  inducementLevel: number | null;
  sweepCandle: Candle;
  hasInducement: boolean;
}

// Find M15 swing points using 2-bar lookback
function findSwingPoints(candles: Candle[]): { swingHighs: { index: number; level: number }[]; swingLows: { index: number; level: number }[] } {
  const swingHighs: { index: number; level: number }[] = [];
  const swingLows: { index: number; level: number }[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high &&
        candles[i].high > candles[i + 1].high && candles[i].high > candles[i + 2].high) {
      swingHighs.push({ index: i, level: candles[i].high });
    }
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low &&
        candles[i].low < candles[i + 1].low && candles[i].low < candles[i + 2].low) {
      swingLows.push({ index: i, level: candles[i].low });
    }
  }

  return { swingHighs, swingLows };
}

function detectM15Entry(m15Candles: Candle[], bias: 'BULLISH' | 'BEARISH', h4Sweep: H4Sweep): M15Entry | null {
  if (m15Candles.length < 10) return null;

  const { swingHighs, swingLows } = findSwingPoints(m15Candles);

  if (bias === 'BEARISH') {
    // For SELL:
    // 1. Find the M15 sweep candle (highest high near the H4 sweep zone)
    let sweepCandleIdx = -1;
    let sweepCandleHigh = 0;

    for (let i = m15Candles.length - 1; i >= Math.max(0, m15Candles.length - 20); i--) {
      if (m15Candles[i].high >= h4Sweep.h4RangeHigh) {
        if (m15Candles[i].high > sweepCandleHigh) {
          sweepCandleHigh = m15Candles[i].high;
          sweepCandleIdx = i;
        }
      }
    }

    if (sweepCandleIdx === -1) {
      // No M15 candle swept the H4 high — use the highest M15 candle in the last 10
      for (let i = m15Candles.length - 1; i >= Math.max(0, m15Candles.length - 10); i--) {
        if (m15Candles[i].high > sweepCandleHigh) {
          sweepCandleHigh = m15Candles[i].high;
          sweepCandleIdx = i;
        }
      }
    }

    if (sweepCandleIdx === -1) return null;

    // 2. Detect BOS: most recent M15 swing low broken downward AFTER the sweep candle
    const recentSwingLows = swingLows.filter(s => s.index < sweepCandleIdx);
    if (recentSwingLows.length === 0) return null;

    const targetSwingLow = recentSwingLows[recentSwingLows.length - 1];

    // Check if any candle AFTER the sweep broke below this swing low
    let bosConfirmed = false;
    for (let i = sweepCandleIdx + 1; i < m15Candles.length; i++) {
      if (m15Candles[i].close < targetSwingLow.level) {
        bosConfirmed = true;
        break;
      }
    }

    // Also check if the current price (last candle close) is below the swing low
    if (!bosConfirmed && m15Candles[m15Candles.length - 1].close < targetSwingLow.level) {
      bosConfirmed = true;
    }

    if (!bosConfirmed) return null;

    // 3. Detect Inducement: minor internal peak between sweep and BOS
    let inducementLevel: number | null = null;
    const minorPeaks = swingHighs.filter(s => s.index > targetSwingLow.index && s.index < sweepCandleIdx && s.level < sweepCandleHigh);
    if (minorPeaks.length > 0) {
      inducementLevel = minorPeaks[minorPeaks.length - 1].level;
    }

    const sweepCandle = m15Candles[sweepCandleIdx];
    const entryPrice = Math.max(sweepCandle.open, sweepCandle.close); // Strong high (body high)
    const stopLoss = sweepCandle.high; // Above the wick

    console.log(`  M15 SELL Entry: entry=${entryPrice}, SL=${stopLoss}, BOS at ${targetSwingLow.level}, Inducement=${inducementLevel || 'none'}`);

    return {
      valid: true,
      entryPrice,
      stopLoss,
      bosLevel: targetSwingLow.level,
      inducementLevel,
      sweepCandle,
      hasInducement: inducementLevel !== null,
    };
  } else {
    // For BUY:
    // 1. Find the M15 sweep candle (lowest low near the H4 sweep zone)
    let sweepCandleIdx = -1;
    let sweepCandleLow = Infinity;

    for (let i = m15Candles.length - 1; i >= Math.max(0, m15Candles.length - 20); i--) {
      if (m15Candles[i].low <= h4Sweep.h4RangeLow) {
        if (m15Candles[i].low < sweepCandleLow) {
          sweepCandleLow = m15Candles[i].low;
          sweepCandleIdx = i;
        }
      }
    }

    if (sweepCandleIdx === -1) {
      for (let i = m15Candles.length - 1; i >= Math.max(0, m15Candles.length - 10); i--) {
        if (m15Candles[i].low < sweepCandleLow) {
          sweepCandleLow = m15Candles[i].low;
          sweepCandleIdx = i;
        }
      }
    }

    if (sweepCandleIdx === -1) return null;

    // 2. Detect BOS: most recent M15 swing high broken upward AFTER the sweep
    const recentSwingHighs = swingHighs.filter(s => s.index < sweepCandleIdx);
    if (recentSwingHighs.length === 0) return null;

    const targetSwingHigh = recentSwingHighs[recentSwingHighs.length - 1];

    let bosConfirmed = false;
    for (let i = sweepCandleIdx + 1; i < m15Candles.length; i++) {
      if (m15Candles[i].close > targetSwingHigh.level) {
        bosConfirmed = true;
        break;
      }
    }

    if (!bosConfirmed && m15Candles[m15Candles.length - 1].close > targetSwingHigh.level) {
      bosConfirmed = true;
    }

    if (!bosConfirmed) return null;

    // 3. Detect Inducement: minor internal trough between sweep and BOS
    let inducementLevel: number | null = null;
    const minorTroughs = swingLows.filter(s => s.index > targetSwingHigh.index && s.index < sweepCandleIdx && s.level > sweepCandleLow);
    if (minorTroughs.length > 0) {
      inducementLevel = minorTroughs[minorTroughs.length - 1].level;
    }

    const sweepCandle = m15Candles[sweepCandleIdx];
    const entryPrice = Math.min(sweepCandle.open, sweepCandle.close); // Strong low (body low)
    const stopLoss = sweepCandle.low; // Below the wick

    console.log(`  M15 BUY Entry: entry=${entryPrice}, SL=${stopLoss}, BOS at ${targetSwingHigh.level}, Inducement=${inducementLevel || 'none'}`);

    return {
      valid: true,
      entryPrice,
      stopLoss,
      bosLevel: targetSwingHigh.level,
      inducementLevel,
      sweepCandle,
      hasInducement: inducementLevel !== null,
    };
  }
}

// =====================================================================
// CRT + MSNR Confidence Scoring
// =====================================================================
function calculateCRTConfidence(
  htfBias: HTFBias,
  h4Sweep: H4Sweep,
  m15Entry: M15Entry,
  dailySR: { support: number[]; resistance: number[] },
  symbol: string,
  signalType: string,
  entryDistancePips: number,
): number {
  // Recalibrated confidence model based on 445-signal analysis
  let confidence = 50; // Base — CRT prerequisites (H4 sweep + M15 BOS) already met

  // HTF rejection quality: weekly is stronger than daily
  if (htfBias.rejectionTimeframe === 'Weekly') {
    confidence += 3;
  } else {
    confidence += 1;
  }

  // H4 sweep confirmed (always true here, modest bonus)
  confidence += 2;

  // M15 Inducement — strongest win-rate predictor
  if (m15Entry.hasInducement) {
    confidence += 10;
  } else {
    confidence -= 8; // No inducement penalty — must compensate with other factors
  }

  // Strong pair+direction combo bonus (+5)
  if (isStrongPairDirection(symbol, signalType)) {
    confidence += 5;
  }

  // Weak/blocked pair penalty (-10) — shouldn't reach here but safety net
  if (isBlockedPairDirection(symbol, signalType)) {
    confidence -= 10;
  }

  // Rejection at a key S/R level
  const allLevels = [...dailySR.support, ...dailySR.resistance];
  const nearKeyLevel = allLevels.some(l => Math.abs(htfBias.rejectionLevel - l) / l < 0.003);
  if (nearKeyLevel) {
    confidence += 2;
  }

  // Entry distance penalty: penalize entries far from current price
  const maxPips = getMaxEntryDistancePips(symbol);
  if (entryDistancePips > maxPips * 0.7) {
    confidence -= 3; // Getting close to max distance
  }

  // Hard cap at 70 (raised from 58 to accommodate inducement bonus)
  return Math.min(70, Math.max(50, confidence));
}

// =====================================================================
// Main CRT Analyzer — orchestrates all 3 steps
// =====================================================================
interface CRTSignal {
  signal: 'BUY' | 'SELL';
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  reasoning: string;
  patternsDetected: string[];
  technicalData: any;
}

async function analyzeCRT(supabase: any, symbol: string, profile: StrategyProfile = DEFAULT_PROFILE): Promise<CRTSignal | null> {
  console.log(`[${symbol}] === CRT + MSNR Analysis (Profile: ${profile.name}) ===`);
  console.log(`[${symbol}] Timeframes: HTF=${profile.htf}, Trigger=${profile.trigger_tf}, Entry=${profile.entry_tf}`);

  // Step 0: Ensure all required timeframe data is cached
  // Process sequentially with small delays to avoid rate-limiting
  await ensureTimeframeData(supabase, symbol, profile.htf);
  await ensureTimeframeData(supabase, symbol, profile.trigger_tf);
  await ensureTimeframeData(supabase, symbol, profile.entry_tf);
  // Also cache 1h data for the dashboard price display
  await ensureTimeframeData(supabase, symbol, '1h');

  // Read cached candles
  let [dailyCandles, h4Candles, m15Candles] = await Promise.all([
    readCandles(supabase, symbol, profile.htf, 200),
    readCandles(supabase, symbol, profile.trigger_tf, 200),
    readCandles(supabase, symbol, profile.entry_tf, 200),
  ]);

  // Fallback: if no daily candles available, synthesize from 4h data
  if (dailyCandles.length < 10 && h4Candles.length >= 20 && profile.htf === '1d') {
    console.log(`[${symbol}] No daily data — synthesizing daily candles from ${h4Candles.length} x 4h candles`);
    dailyCandles = aggregate4hToDaily(h4Candles);
    console.log(`[${symbol}] Synthesized ${dailyCandles.length} daily candles from 4h data`);
  }

  console.log(`[${symbol}] Data: Daily=${dailyCandles.length}, H4=${h4Candles.length}, M15=${m15Candles.length}`);

  if (dailyCandles.length < 10 || h4Candles.length < 5 || m15Candles.length < 10) {
    console.log(`[${symbol}] Insufficient data for CRT analysis`);
    return null;
  }

  // Aggregate weekly candles from daily
  const weeklyCandles = aggregateWeeklyCandles(dailyCandles);
  console.log(`[${symbol}] Weekly candles aggregated: ${weeklyCandles.length}`);

  // Calculate Daily S/R levels for bias validation
  const dailySR = calculateSR(dailyCandles);
  console.log(`[${symbol}] Daily S/R: ${dailySR.support.length} supports, ${dailySR.resistance.length} resistances`);

  // ---- Step A: HTF Bias ----
  const htfBias = detectHTFBias(weeklyCandles, dailyCandles, dailySR);
  if (!htfBias) {
    console.log(`[${symbol}] Step A FAILED: No HTF bias detected — skipping`);
    return null;
  }
  console.log(`[${symbol}] Step A PASS: ${htfBias.bias} bias (${htfBias.rejectionTimeframe} rejection at ${htfBias.rejectionLevel})`);

  // ---- Step B: H4 CRT Sweep ----
  const h4Sweep = detectH4Sweep(h4Candles, htfBias.bias);
  if (!h4Sweep) {
    console.log(`[${symbol}] Step B FAILED: No H4 sweep detected — skipping`);
    return null;
  }
  console.log(`[${symbol}] Step B PASS: H4 Range ${h4Sweep.h4RangeLow} - ${h4Sweep.h4RangeHigh}`);

  // ---- Step C: M15 MSNR Entry ----
  const m15Entry = detectM15Entry(m15Candles, htfBias.bias, h4Sweep);
  if (!m15Entry || !m15Entry.valid) {
    console.log(`[${symbol}] Step C FAILED: No M15 BOS entry — skipping`);
    return null;
  }
  console.log(`[${symbol}] Step C PASS: Entry=${m15Entry.entryPrice}, SL=${m15Entry.stopLoss}, BOS=${m15Entry.bosLevel}`);

  // ---- Signal Construction ----
  const signalType: 'BUY' | 'SELL' = htfBias.bias === 'BULLISH' ? 'BUY' : 'SELL';

  // ---- NEW: Pair+Direction Blocklist Check ----
  if (isBlockedPairDirection(symbol, signalType)) {
    console.log(`[${symbol}] BLOCKED: ${symbol} ${signalType} is on the underperforming pair blocklist — skipping`);
    return null;
  }

  // ---- NEW: Require Inducement Confirmation ----
  if (!m15Entry.hasInducement) {
    console.log(`[${symbol}] SKIPPED: No M15 Inducement detected — signals without inducement have 61.4% vs 78.4% win rate`);
    return null;
  }

  // ---- NEW: Entry Distance Check ----
  const currentPrice = m15Candles[m15Candles.length - 1].close;
  const pipValue = getPipValue(symbol);
  const entryDistancePips = Math.abs(currentPrice - m15Entry.entryPrice) / pipValue;
  const maxDistPips = getMaxEntryDistancePips(symbol);
  if (entryDistancePips > maxDistPips) {
    console.log(`[${symbol}] SKIPPED: Entry too far from price (${entryDistancePips.toFixed(1)} pips > max ${maxDistPips} pips)`);
    return null;
  }

  const confidence = calculateCRTConfidence(htfBias, h4Sweep, m15Entry, dailySR, symbol, signalType, entryDistancePips);

  // TP = opposite side of H4 range
  const takeProfit1 = signalType === 'SELL' ? h4Sweep.h4RangeLow : h4Sweep.h4RangeHigh;

  // Build reasoning string for Telegram
  const reasoning =
    `${signalType} opportunity detected on ${symbol} with ${confidence}% confidence.\n\n` +
    `Bias: ${htfBias.bias} (${htfBias.rejectionTimeframe} resistance rejection at ${htfBias.rejectionLevel.toFixed(5)})\n` +
    `Setup: H4 Candle Range Sweep Confirmed (H4 ${signalType === 'SELL' ? 'High' : 'Low'} ${signalType === 'SELL' ? h4Sweep.h4RangeHigh.toFixed(5) : h4Sweep.h4RangeLow.toFixed(5)} swept)\n` +
    `Entry Model: MSNR Model 1 (BOS + Inducement)\n\n` +
    `H4 Range: ${h4Sweep.h4RangeLow.toFixed(5)} - ${h4Sweep.h4RangeHigh.toFixed(5)}\n` +
    `M15 BOS at: ${m15Entry.bosLevel.toFixed(5)}\n` +
    `Inducement: ${m15Entry.inducementLevel!.toFixed(5)}\n` +
    `Entry Distance: ${entryDistancePips.toFixed(1)} pips\n` +
    `Current Price: ${currentPrice.toFixed(5)}`;

  const patternsDetected = [
    `${htfBias.rejectionTimeframe} ${htfBias.bias} Rejection`,
    'H4 CRT Sweep',
    'M15 BOS',
    'M15 Inducement',
  ];

  // Add 5-pip buffer to SL beyond the M15 sweep wick for breathing room
  const slBuffer = 5 * pipValue;
  const structuralSL = signalType === 'SELL' 
    ? m15Entry.stopLoss + slBuffer   // Above the wick for SELL
    : m15Entry.stopLoss - slBuffer;  // Below the wick for BUY

  // Enforce ATR-based minimum SL distance so stops aren't too tight
  const m15Highs = m15Candles.map((c: any) => c.high);
  const m15Lows = m15Candles.map((c: any) => c.low);
  const m15Closes = m15Candles.map((c: any) => c.close);
  const atrPeriod = 14;
  let atr = 0;
  if (m15Closes.length >= atrPeriod + 1) {
    const trueRanges: number[] = [];
    for (let i = 1; i < m15Closes.length; i++) {
      const tr = Math.max(
        m15Highs[i] - m15Lows[i],
        Math.abs(m15Highs[i] - m15Closes[i - 1]),
        Math.abs(m15Lows[i] - m15Closes[i - 1])
      );
      trueRanges.push(tr);
    }
    atr = trueRanges.slice(-atrPeriod).reduce((a: number, b: number) => a + b, 0) / atrPeriod;
  }
  const minSLDistance = atr * 1.5;
  const structuralDistance = Math.abs(m15Entry.entryPrice - structuralSL);
  
  let bufferedStopLoss: number;
  if (minSLDistance > 0 && structuralDistance < minSLDistance) {
    // Widen SL to ATR-based minimum
    bufferedStopLoss = signalType === 'SELL'
      ? m15Entry.entryPrice + minSLDistance
      : m15Entry.entryPrice - minSLDistance;
    console.log(`[${symbol}] SL widened: structural=${(structuralDistance / pipValue).toFixed(1)} pips, ATR min=${(minSLDistance / pipValue).toFixed(1)} pips`);
  } else {
    bufferedStopLoss = structuralSL;
    console.log(`[${symbol}] SL kept structural: ${(structuralDistance / pipValue).toFixed(1)} pips (ATR min=${(minSLDistance / pipValue).toFixed(1)} pips)`);
  }

  return {
    signal: signalType,
    confidence,
    entryPrice: m15Entry.entryPrice,
    stopLoss: bufferedStopLoss,
    takeProfit1,
    takeProfit2: null, // CRT uses single TP at opposite range
    reasoning,
    patternsDetected,
    technicalData: {
      htfBias,
      h4Sweep: { h4RangeHigh: h4Sweep.h4RangeHigh, h4RangeLow: h4Sweep.h4RangeLow },
      m15Entry: { bosLevel: m15Entry.bosLevel, inducementLevel: m15Entry.inducementLevel },
      dailySR,
    },
  };
}

// =====================================================================
// Prop Firm Compliance Validation
// =====================================================================
interface PropFirmValidation {
  allowed: boolean;
  reason: string;
  constraint: string;
  currentValue?: number;
  limitValue?: number;
}

async function validatePropFirmRules(
  supabase: any,
  userId: string | undefined,
  signal: { signal_type: string; symbol: string; entry_price: number; stop_loss: number },
): Promise<PropFirmValidation> {
  if (!userId) return { allowed: true, reason: 'No user context', constraint: 'none' };

  // Check if user has prop_firm_compliance feature
  const { data: hasFeature } = await supabase.rpc('has_feature', {
    _user_id: userId,
    _feature: 'prop_firm_compliance',
  });
  if (!hasFeature) return { allowed: true, reason: 'Feature not enabled', constraint: 'none' };

  // Load constraints
  const { data: constraints, error } = await supabase
    .from('user_prop_constraints')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true)
    .maybeSingle();

  if (error || !constraints) return { allowed: true, reason: 'No constraints configured', constraint: 'none' };

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Check 1: Max trades per day
  const { count: todayTradeCount } = await supabase
    .from('trading_opportunities')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString())
    .in('status', ['ACTIVE', 'COMPLETED', 'CLOSED', 'EXPIRED']);

  if ((todayTradeCount || 0) >= constraints.max_trades_per_day) {
    return {
      allowed: false,
      reason: `Daily trade limit reached (${todayTradeCount}/${constraints.max_trades_per_day})`,
      constraint: 'max_trades_per_day',
      currentValue: todayTradeCount || 0,
      limitValue: constraints.max_trades_per_day,
    };
  }

  // Check 2: Max open trades
  const { count: openTradeCount } = await supabase
    .from('trading_opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ACTIVE');

  if ((openTradeCount || 0) >= constraints.max_open_trades) {
    return {
      allowed: false,
      reason: `Open trade limit reached (${openTradeCount}/${constraints.max_open_trades})`,
      constraint: 'max_open_trades',
      currentValue: openTradeCount || 0,
      limitValue: constraints.max_open_trades,
    };
  }

  // Check 3: Max risk percent (SL distance as % of entry)
  const riskPercent = Math.abs(signal.entry_price - signal.stop_loss) / signal.entry_price * 100;
  if (riskPercent > constraints.max_risk_percent) {
    return {
      allowed: false,
      reason: `Risk per trade too high (${riskPercent.toFixed(2)}% > ${constraints.max_risk_percent}%)`,
      constraint: 'max_risk_percent',
      currentValue: riskPercent,
      limitValue: constraints.max_risk_percent,
    };
  }

  return { allowed: true, reason: 'All prop firm rules passed', constraint: 'none' };
}

async function recordBlockedSignal(
  supabase: any,
  userId: string,
  signal: { signal_type: string; symbol: string },
  validation: PropFirmValidation,
) {
  await supabase.from('blocked_signals').insert({
    user_id: userId,
    signal_type: signal.signal_type,
    symbol: signal.symbol,
    block_reason: validation.reason,
    constraint_violated: validation.constraint,
    current_value: validation.currentValue ?? null,
    limit_value: validation.limitValue ?? null,
  });

  // Check for repeated blocks (3+ in last hour) → alert via Telegram
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentBlocks } = await supabase
    .from('blocked_signals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo);

  if ((recentBlocks || 0) >= 3) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      await fetch(`${supabaseUrl}/functions/v1/send-telegram-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          symbol: signal.symbol,
          signal_type: 'PROP_FIRM_ALERT',
          confidence: 0,
          entry_price: 0,
          reasoning: `⚠️ Prop Firm Compliance: ${recentBlocks} signals blocked in the last hour.\nLatest: ${validation.reason}`,
        }),
      }).then(r => r.text());
    } catch (e) {
      console.error('Failed to send prop firm Telegram alert:', e);
    }
  }
}

// =====================================================================
// Scan a single symbol for CRT + MSNR opportunities
// =====================================================================
async function scanSymbol(
  supabase: any,
  symbol: string,
  userId?: string,
  profile: StrategyProfile = DEFAULT_PROFILE,
): Promise<{ success: boolean; opportunity?: any; message: string }> {
  console.log(`\n========== Scanning ${symbol} (Profile: ${profile.name}) ==========`);

  // Run the CRT + MSNR analysis with the resolved profile
  const analysis = await analyzeCRT(supabase, symbol, profile);

  if (!analysis) {
    return { success: true, message: `No CRT+MSNR setup for ${symbol}` };
  }

  const currentPrice = analysis.entryPrice;

  // Check for conflicting active signals (opposite direction)
  const oppositeSignal = analysis.signal === 'BUY' ? 'SELL' : 'BUY';
  const { data: conflictingOpps } = await supabase
    .from('trading_opportunities')
    .select('id, signal_type, confidence, created_at, entry_price')
    .eq('status', 'ACTIVE')
    .eq('symbol', symbol)
    .eq('signal_type', oppositeSignal);

  let isSignalReversal = false;
  let previousSignal: { signal_type: string; confidence: number; created_at: string } | null = null;

  if (conflictingOpps && conflictingOpps.length > 0) {
    const mostRecentConflict = conflictingOpps[0];
    const conflictAge = Date.now() - new Date(mostRecentConflict.created_at).getTime();
    const oneHourMs = 60 * 60 * 1000;

    if (conflictAge < oneHourMs && analysis.confidence < mostRecentConflict.confidence + 10) {
      console.log(`[${symbol}] Cooldown active: ${oppositeSignal} signal is less than 1 hour old`);
      return { success: true, message: `Cooldown active for ${symbol}` };
    }

    console.log(`[${symbol}] Expiring ${conflictingOpps.length} conflicting ${oppositeSignal} signal(s) due to reversal`);
    await supabase
      .from('trading_opportunities')
      .update({ status: 'EXPIRED', outcome: 'EXPIRED' })
      .eq('status', 'ACTIVE')
      .eq('symbol', symbol)
      .eq('signal_type', oppositeSignal);

    isSignalReversal = true;
    previousSignal = {
      signal_type: mostRecentConflict.signal_type,
      confidence: mostRecentConflict.confidence,
      created_at: mostRecentConflict.created_at,
    };
  }

  // Enhanced duplicate check - look at recent opportunities (4 hours)
  const { data: recentOpps } = await supabase
    .from('trading_opportunities')
    .select('id, signal_type, entry_price, created_at, status')
    .eq('symbol', symbol)
    .eq('signal_type', analysis.signal)
    .gte('created_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());

  if (recentOpps && recentOpps.length > 0) {
    const pipValue = getPipValue(symbol);
    const tooClose = recentOpps.some((opp: any) => {
      const pipsDiff = Math.abs(currentPrice - opp.entry_price) / pipValue;
      return pipsDiff < 15;
    });

    if (tooClose) {
      console.log(`[${symbol}] Similar opportunity exists within 15 pips — skipping`);
      return { success: true, message: `Similar ${analysis.signal} opportunity exists for ${symbol}` };
    }

    console.log(`[${symbol}] Price moved 15+ pips from all recent ${analysis.signal} signals — creating new opportunity`);
  }

  // Prop Firm Compliance Check
  if (userId) {
    const propValidation = await validatePropFirmRules(supabase, userId, {
      signal_type: analysis.signal,
      symbol,
      entry_price: analysis.entryPrice,
      stop_loss: analysis.stopLoss,
    });

    if (!propValidation.allowed) {
      console.log(`[${symbol}] BLOCKED by prop firm rules: ${propValidation.reason}`);
      await recordBlockedSignal(supabase, userId, { signal_type: analysis.signal, symbol }, propValidation);
      return { success: true, message: `Blocked: ${propValidation.reason}` };
    }
  }

  // Insert opportunity
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours

  const { data: newOpp, error: insertError } = await supabase
    .from('trading_opportunities')
    .insert({
      symbol,
      signal_type: analysis.signal,
      confidence: analysis.confidence,
      entry_price: analysis.entryPrice,
      current_price: currentPrice,
      stop_loss: analysis.stopLoss,
      take_profit_1: analysis.takeProfit1,
      take_profit_2: analysis.takeProfit2,
      patterns_detected: analysis.patternsDetected,
      technical_indicators: analysis.technicalData,
      pattern_stats: null,
      reasoning: analysis.reasoning,
      status: 'ACTIVE',
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error(`[${symbol}] Failed to insert opportunity:`, insertError);
    return { success: false, message: `Failed to save opportunity for ${symbol}` };
  }

  console.log(`[${symbol}] Created new CRT opportunity:`, newOpp.id);

  // Send Telegram notification
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const telegramResp = await fetch(`${supabaseUrl}/functions/v1/send-telegram-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        symbol,
        signal_type: newOpp.signal_type,
        confidence: newOpp.confidence,
        entry_price: newOpp.entry_price,
        stop_loss: newOpp.stop_loss,
        take_profit_1: newOpp.take_profit_1,
        take_profit_2: newOpp.take_profit_2,
        reasoning: newOpp.reasoning,
        is_reversal: isSignalReversal,
        previous_signal: previousSignal,
      }),
    });
    const telegramBody = await telegramResp.text();
    console.log(`[${symbol}] Telegram response (${telegramResp.status}):`, telegramBody);
    
    if (telegramResp.ok) {
      // Update notification_sent_at
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const adminClient = createClient(supabaseUrl, serviceKey);
      await adminClient.from('trading_opportunities').update({ notification_sent_at: new Date().toISOString() }).eq('id', newOpp.id);
      console.log(`[${symbol}] Telegram notification sent for opportunity:`, newOpp.id, isSignalReversal ? "(REVERSAL)" : "");
    } else {
      console.error(`[${symbol}] Telegram notification failed (${telegramResp.status}):`, telegramBody);
    }
  } catch (notifyError) {
    console.error(`[${symbol}] Failed to send Telegram notification:`, notifyError);
  }

  return {
    success: true,
    opportunity: newOpp,
    message: `New ${analysis.signal} CRT opportunity for ${symbol}!`,
  };
}

// =====================================================================
// Main serve handler
// =====================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting CRT + MSNR opportunity scan...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));

    // Resolve strategy profile
    const profileId = body?.profile_id as string | undefined;
    const profile = await resolveProfile(supabase, profileId);

    // Session timing filter: if a user_id is provided, check session preferences
    const userId = body?.user_id as string | undefined;
    if (userId) {
      const sessionCheck = await isSessionAllowed(supabase, userId);
      console.log(`Session check for user ${userId}: ${sessionCheck.reason} (session=${sessionCheck.session})`);
      if (!sessionCheck.allowed) {
        return new Response(
          JSON.stringify({
            success: true,
            message: sessionCheck.reason,
            scanned: false,
            session: sessionCheck.session,
            sessionFiltered: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get active pairs from database or use provided symbols
    let requestedSymbols: string[];
    if (body?.symbols) {
      requestedSymbols = body.symbols;
    } else if (body?.symbol) {
      requestedSymbols = [body.symbol];
    } else {
      const activePairs = await getActiveCurrencyPairs(supabase);
      requestedSymbols = activePairs.map(p => p.symbol);

      if (requestedSymbols.length === 0) {
        console.log("No active currency pairs found in database");
        return new Response(
          JSON.stringify({ success: true, message: "No active currency pairs configured", scanned: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check market status
    const marketStatus = isForexMarketOpen();
    if (!marketStatus.isOpen) {
      console.log("Market closed:", marketStatus.reason);
      return new Response(
        JSON.stringify({ success: true, message: marketStatus.reason, scanned: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Expire old opportunities (all symbols)
    await supabase
      .from('trading_opportunities')
      .update({ status: 'EXPIRED' })
      .eq('status', 'ACTIVE')
      .lt('expires_at', new Date().toISOString());

    // Scan each symbol
    const results: { symbol: string; opportunity?: any; message: string }[] = [];
    const newOpportunities: any[] = [];

    for (const symbol of requestedSymbols) {
      const result = await scanSymbol(supabase, symbol, userId, profile);
      results.push({ symbol, ...result });
      if (result.opportunity) {
        newOpportunities.push(result.opportunity);
      }
    }

    console.log(`\n========== CRT Scan Complete ==========`);
    console.log(`Scanned ${requestedSymbols.length} pairs, found ${newOpportunities.length} opportunities`);

    return new Response(
      JSON.stringify({
        success: true,
        message: newOpportunities.length > 0
          ? `Found ${newOpportunities.length} new CRT opportunity(ies)!`
          : "No CRT+MSNR setups detected",
        scanned: true,
        symbolsScanned: requestedSymbols.length,
        opportunitiesFound: newOpportunities.length,
        opportunities: newOpportunities,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Scan error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
