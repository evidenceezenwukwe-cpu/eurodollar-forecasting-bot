import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
      return new Response(JSON.stringify({ error: "Telegram not configured" }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get today's date range (UTC)
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));

    // Query all opportunities created today
    const { data: todaySignals } = await supabase
      .from('trading_opportunities')
      .select('*')
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString());

    // Query all opportunities evaluated/resolved today
    const { data: resolvedToday } = await supabase
      .from('trading_opportunities')
      .select('*')
      .not('outcome', 'is', null)
      .gte('evaluated_at', startOfDay.toISOString())
      .lte('evaluated_at', endOfDay.toISOString());

    const totalSignals = todaySignals?.length || 0;
    const resolved = resolvedToday || [];
    const wins = resolved.filter(o => o.outcome === 'WIN');
    const losses = resolved.filter(o => o.outcome === 'LOSS');
    const expired = resolved.filter(o => o.outcome === 'EXPIRED');
    const winRate = resolved.length > 0 ? ((wins.length / resolved.length) * 100).toFixed(1) : '0.0';

    // Calculate total pips
    let totalPipsWon = 0;
    let totalPipsLost = 0;

    for (const opp of resolved) {
      if (!opp.entry_price) continue;
      // Determine pip value based on symbol
      const isJPY = opp.symbol?.includes('JPY');
      const isXAU = opp.symbol?.includes('XAU');
      const pipMultiplier = isXAU ? 10 : isJPY ? 100 : 10000;

      if (opp.outcome === 'WIN' && opp.take_profit_1) {
        const pips = Math.abs(opp.take_profit_1 - opp.entry_price) * pipMultiplier;
        totalPipsWon += pips;
      } else if (opp.outcome === 'LOSS' && opp.stop_loss) {
        const pips = Math.abs(opp.stop_loss - opp.entry_price) * pipMultiplier;
        totalPipsLost += pips;
      }
    }

    const netPips = totalPipsWon - totalPipsLost;
    const dateStr = now.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Build per-symbol breakdown if there are results
    let symbolBreakdown = '';
    if (resolved.length > 0) {
      const bySymbol: Record<string, { wins: number; losses: number; expired: number }> = {};
      for (const opp of resolved) {
        const sym = opp.symbol || 'EUR/USD';
        if (!bySymbol[sym]) bySymbol[sym] = { wins: 0, losses: 0, expired: 0 };
        if (opp.outcome === 'WIN') bySymbol[sym].wins++;
        else if (opp.outcome === 'LOSS') bySymbol[sym].losses++;
        else bySymbol[sym].expired++;
      }
      const lines = Object.entries(bySymbol).map(([sym, stats]) => {
        return `  ${sym}: ✅${stats.wins} ❌${stats.losses} ⏳${stats.expired}`;
      });
      symbolBreakdown = `\n📋 *By Pair:*\n${lines.join('\n')}`;
    }

    const message = `
📊 *DAILY PERFORMANCE REPORT*
📅 ${dateStr}

📈 Signals Generated: ${totalSignals}
🏁 Signals Resolved: ${resolved.length}

✅ Wins: ${wins.length}
❌ Losses: ${losses.length}
⏳ Expired: ${expired.length}

💯 Win Rate: ${winRate}%
💰 Pips Won: +${totalPipsWon.toFixed(1)}
📉 Pips Lost: -${totalPipsLost.toFixed(1)}
${netPips >= 0 ? '🟢' : '🔴'} Net: ${netPips >= 0 ? '+' : ''}${netPips.toFixed(1)} pips
${symbolBreakdown}

_ForexTell AI - End of Day Summary_
    `.trim();

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );

    const result = await response.json();
    console.log("Daily report Telegram response:", result);

    if (!result.ok) {
      throw new Error(result.description || 'Telegram API error');
    }

    return new Response(JSON.stringify({ success: true, totalSignals, resolved: resolved.length, wins: wins.length, losses: losses.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Daily report error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
