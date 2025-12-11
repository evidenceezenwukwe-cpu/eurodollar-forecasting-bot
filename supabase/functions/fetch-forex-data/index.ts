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
    const { timeframe = "1h", outputsize = 100 } = await req.json();
    
    const TWELVE_DATA_API_KEY = Deno.env.get("TWELVE_DATA_API_KEY");
    if (!TWELVE_DATA_API_KEY) {
      throw new Error("TWELVE_DATA_API_KEY is not configured");
    }

    console.log(`Fetching EUR/USD data with timeframe: ${timeframe}, outputsize: ${outputsize}`);

    // Fetch time series data from Twelve Data
    const url = `https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=${timeframe}&outputsize=${outputsize}&apikey=${TWELVE_DATA_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "error") {
      console.error("Twelve Data API error:", data.message);
      throw new Error(data.message || "Failed to fetch forex data");
    }

    if (!data.values || !Array.isArray(data.values)) {
      console.error("Unexpected response format:", data);
      throw new Error("Invalid response format from Twelve Data");
    }

    console.log(`Received ${data.values.length} candles from Twelve Data`);

    // Transform the data to our format
    const candles = data.values.map((candle: any) => ({
      timestamp: candle.datetime,
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: candle.volume ? parseFloat(candle.volume) : null,
    })).reverse(); // Reverse to get chronological order

    // Get current price (latest close)
    const currentPrice = candles[candles.length - 1]?.close || 0;

    // Cache data in Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Upsert price history (last 50 candles)
    const priceHistoryData = candles.slice(-50).map((candle: any) => ({
      symbol: "EUR/USD",
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timeframe: timeframe,
    }));

    const { error: upsertError } = await supabase
      .from("price_history")
      .upsert(priceHistoryData, { onConflict: "symbol,timestamp,timeframe" });

    if (upsertError) {
      console.error("Error caching price data:", upsertError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        symbol: "EUR/USD",
        currentPrice,
        candles,
        meta: data.meta,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching forex data:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
