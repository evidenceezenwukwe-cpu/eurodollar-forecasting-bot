import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getSession(timestamp: string): string {
  const d = new Date(timestamp);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const t = h * 60 + m;
  if (t >= 23 * 60 || t < 8 * 60) return "ASIA";
  if (t >= 7 * 60 && t < 16 * 60) return "LONDON";
  if (t >= 12 * 60 && t < 21 * 60) return "NEWYORK";
  return "OTHER";
}

interface AggKey {
  pattern_name: string;
  symbol: string;
  timeframe: string;
  session: string;
}

interface AggBucket {
  wins: number;
  losses: number;
  totalPips: number;
  grossProfit: number;
  grossLoss: number;
  recentResults: { outcome: string; pips: number; date: string }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Starting pattern metrics recomputation...");

    // Fetch all evaluated opportunities with outcomes
    const { data: opps, error: oppsError } = await supabase
      .from("trading_opportunities")
      .select("id, symbol, signal_type, patterns_detected, entry_price, stop_loss, take_profit_1, outcome, created_at, evaluated_at")
      .in("outcome", ["WIN", "LOSS"])
      .not("patterns_detected", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (oppsError) throw new Error(`Failed to fetch opportunities: ${oppsError.message}`);

    console.log(`Processing ${opps?.length || 0} evaluated opportunities`);

    const buckets = new Map<string, AggBucket>();

    for (const opp of opps || []) {
      const symbol = opp.symbol || "EUR/USD";
      const session = getSession(opp.created_at);
      const patterns: string[] = Array.isArray(opp.patterns_detected) ? opp.patterns_detected : [];
      const isWin = opp.outcome === "WIN";

      // Calculate pips
      const pipDiv = symbol.includes("JPY") ? 0.01 : 0.0001;
      const pips = opp.take_profit_1 && opp.stop_loss
        ? isWin
          ? Math.abs(opp.take_profit_1 - opp.entry_price) / pipDiv
          : Math.abs(opp.entry_price - opp.stop_loss) / pipDiv * -1
        : 0;

      const rr = opp.take_profit_1 && opp.stop_loss
        ? Math.abs(opp.take_profit_1 - opp.entry_price) / Math.max(Math.abs(opp.entry_price - opp.stop_loss), pipDiv)
        : 0;

      for (const pattern of patterns) {
        // Aggregate per session AND "ALL"
        for (const sess of [session, "ALL"]) {
          const key = JSON.stringify({ pattern_name: pattern, symbol, timeframe: "1h", session: sess });
          if (!buckets.has(key)) {
            buckets.set(key, { wins: 0, losses: 0, totalPips: 0, grossProfit: 0, grossLoss: 0, recentResults: [] });
          }
          const b = buckets.get(key)!;
          if (isWin) {
            b.wins++;
            b.grossProfit += Math.abs(pips);
          } else {
            b.losses++;
            b.grossLoss += Math.abs(pips);
          }
          b.totalPips += pips;
          b.recentResults.push({ outcome: opp.outcome!, pips: Math.round(pips * 10) / 10, date: opp.created_at });
        }
      }
    }

    // Trim recent results to last 10 per bucket
    for (const b of buckets.values()) {
      b.recentResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      b.recentResults = b.recentResults.slice(0, 10);
    }

    // Build upsert rows
    const rows = Array.from(buckets.entries()).map(([keyStr, b]) => {
      const k: AggKey = JSON.parse(keyStr);
      const total = b.wins + b.losses;
      return {
        pattern_name: k.pattern_name,
        symbol: k.symbol,
        timeframe: k.timeframe,
        session: k.session,
        trades_count: total,
        wins: b.wins,
        losses: b.losses,
        win_rate: total > 0 ? Math.round((b.wins / total) * 10000) / 100 : 0,
        avg_pips: total > 0 ? Math.round((b.totalPips / total) * 10) / 10 : 0,
        avg_rr: total > 0 ? Math.round((b.grossProfit / Math.max(b.grossLoss, 0.01)) * 100) / 100 : 0,
        profit_factor: b.grossLoss > 0 ? Math.round((b.grossProfit / b.grossLoss) * 100) / 100 : b.grossProfit > 0 ? 999 : 0,
        recent_results: b.recentResults,
        last_updated: new Date().toISOString(),
      };
    });

    console.log(`Upserting ${rows.length} pattern metric rows`);

    if (rows.length > 0) {
      // Batch upsert in chunks of 50
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const { error: upsertError } = await supabase
          .from("pattern_metrics")
          .upsert(chunk, { onConflict: "pattern_name,symbol,timeframe,session", ignoreDuplicates: false });

        if (upsertError) {
          console.error(`Upsert error at chunk ${i}:`, upsertError);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, metrics_count: rows.length, opportunities_processed: opps?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Recompute error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
