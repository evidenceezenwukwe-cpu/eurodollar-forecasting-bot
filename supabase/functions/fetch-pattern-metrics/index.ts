import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    const timeframe = url.searchParams.get("timeframe");
    const session = url.searchParams.get("session");
    const minTrades = parseInt(url.searchParams.get("min_trades") || "0");
    const sortBy = url.searchParams.get("sort_by") || "win_rate";
    const sortDir = url.searchParams.get("sort_dir") === "asc" ? true : false;

    let query = supabase
      .from("pattern_metrics")
      .select("*")
      .gte("trades_count", minTrades)
      .order(sortBy, { ascending: sortDir });

    if (symbol) query = query.eq("symbol", symbol);
    if (timeframe) query = query.eq("timeframe", timeframe);
    if (session) query = query.eq("session", session);

    const { data, error } = await query.limit(200);

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, data, count: data?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
