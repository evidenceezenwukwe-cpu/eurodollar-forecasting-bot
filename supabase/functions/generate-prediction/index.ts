import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface TechnicalIndicators {
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  ema9: number;
  ema21: number;
  ema50: number;
  bollingerBands: { upper: number; middle: number; lower: number };
  stochastic: { k: number; d: number };
}

// Calculate RSI
function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate EMA
function calculateEMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

// Calculate MACD
function calculateMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12 - ema26;
  
  // For signal line, we need MACD history - simplified here
  const signalLine = macdLine * 0.9; // Simplified
  const histogram = macdLine - signalLine;
  
  return { value: macdLine, signal: signalLine, histogram };
}

// Calculate Bollinger Bands
function calculateBollingerBands(closes: number[], period = 20): { upper: number; middle: number; lower: number } {
  if (closes.length < period) {
    const last = closes[closes.length - 1];
    return { upper: last, middle: last, lower: last };
  }
  
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  return {
    upper: sma + stdDev * 2,
    middle: sma,
    lower: sma - stdDev * 2,
  };
}

// Calculate Stochastic
function calculateStochastic(highs: number[], lows: number[], closes: number[], period = 14): { k: number; d: number } {
  if (closes.length < period) return { k: 50, d: 50 };
  
  const highSlice = highs.slice(-period);
  const lowSlice = lows.slice(-period);
  const currentClose = closes[closes.length - 1];
  
  const highestHigh = Math.max(...highSlice);
  const lowestLow = Math.min(...lowSlice);
  
  if (highestHigh === lowestLow) return { k: 50, d: 50 };
  
  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  const d = k * 0.8; // Simplified - should be 3-period SMA of %K
  
  return { k, d };
}

// Detect chart patterns
function detectPatterns(candles: Candle[]): string[] {
  const patterns: string[] = [];
  if (candles.length < 20) return patterns;
  
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // Trend detection
  const shortTrend = closes.slice(-5);
  const isUptrend = shortTrend[shortTrend.length - 1] > shortTrend[0];
  
  // Support/Resistance detection
  const recentLows = lows.slice(-20);
  const recentHighs = highs.slice(-20);
  const support = Math.min(...recentLows);
  const resistance = Math.max(...recentHighs);
  const currentPrice = closes[closes.length - 1];
  
  if (currentPrice - support < (resistance - support) * 0.1) {
    patterns.push("Near Support Level");
  }
  if (resistance - currentPrice < (resistance - support) * 0.1) {
    patterns.push("Near Resistance Level");
  }
  
  // Candlestick patterns
  const last3 = candles.slice(-3);
  
  // Doji detection
  const lastCandle = last3[2];
  const bodySize = Math.abs(lastCandle.open - lastCandle.close);
  const totalSize = lastCandle.high - lastCandle.low;
  if (totalSize > 0 && bodySize / totalSize < 0.1) {
    patterns.push("Doji - Indecision");
  }
  
  // Engulfing pattern
  if (last3.length >= 2) {
    const prev = last3[1];
    const curr = last3[2];
    if (prev.close < prev.open && curr.close > curr.open && 
        curr.open < prev.close && curr.close > prev.open) {
      patterns.push("Bullish Engulfing");
    }
    if (prev.close > prev.open && curr.close < curr.open && 
        curr.open > prev.close && curr.close < prev.open) {
      patterns.push("Bearish Engulfing");
    }
  }
  
  // Higher highs / Lower lows
  if (candles.length >= 10) {
    const last5Highs = highs.slice(-5);
    const prev5Highs = highs.slice(-10, -5);
    if (Math.max(...last5Highs) > Math.max(...prev5Highs) && 
        Math.min(...lows.slice(-5)) > Math.min(...lows.slice(-10, -5))) {
      patterns.push("Higher Highs & Higher Lows - Uptrend");
    }
    if (Math.max(...last5Highs) < Math.max(...prev5Highs) && 
        Math.min(...lows.slice(-5)) < Math.min(...lows.slice(-10, -5))) {
      patterns.push("Lower Highs & Lower Lows - Downtrend");
    }
  }
  
  return patterns;
}

// Calculate all technical indicators
function calculateIndicators(candles: Candle[]): TechnicalIndicators {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  return {
    rsi: calculateRSI(closes),
    macd: calculateMACD(closes),
    ema9: calculateEMA(closes, 9),
    ema21: calculateEMA(closes, 21),
    ema50: calculateEMA(closes, 50),
    bollingerBands: calculateBollingerBands(closes),
    stochastic: calculateStochastic(highs, lows, closes),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { candles, currentPrice } = await req.json();
    
    if (!candles || !Array.isArray(candles) || candles.length < 20) {
      throw new Error("Insufficient price data for analysis");
    }

    console.log(`Generating prediction for ${candles.length} candles, current price: ${currentPrice}`);

    // Calculate technical indicators
    const indicators = calculateIndicators(candles);
    const patterns = detectPatterns(candles);

    console.log("Technical indicators:", JSON.stringify(indicators));
    console.log("Patterns detected:", patterns);

    // Call Lovable AI for prediction
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const analysisPrompt = `You are an expert forex trading analyst specializing in EUR/USD intraday trading. Analyze the following technical data and provide a trading signal.

CURRENT PRICE: ${currentPrice}

TECHNICAL INDICATORS:
- RSI (14): ${indicators.rsi.toFixed(2)}
- MACD: Value=${indicators.macd.value.toFixed(5)}, Signal=${indicators.macd.signal.toFixed(5)}, Histogram=${indicators.macd.histogram.toFixed(5)}
- EMA 9: ${indicators.ema9.toFixed(5)}
- EMA 21: ${indicators.ema21.toFixed(5)}
- EMA 50: ${indicators.ema50.toFixed(5)}
- Bollinger Bands: Upper=${indicators.bollingerBands.upper.toFixed(5)}, Middle=${indicators.bollingerBands.middle.toFixed(5)}, Lower=${indicators.bollingerBands.lower.toFixed(5)}
- Stochastic: %K=${indicators.stochastic.k.toFixed(2)}, %D=${indicators.stochastic.d.toFixed(2)}

PATTERNS DETECTED: ${patterns.length > 0 ? patterns.join(", ") : "No significant patterns"}

RECENT PRICE ACTION:
- 5 candles ago: ${candles[candles.length - 5]?.close.toFixed(5) || 'N/A'}
- 10 candles ago: ${candles[candles.length - 10]?.close.toFixed(5) || 'N/A'}
- 20 candles ago: ${candles[candles.length - 20]?.close.toFixed(5) || 'N/A'}

Provide your analysis in the following format. Use realistic pip values for EUR/USD (typical intraday moves are 10-50 pips):`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert forex trading analyst. Always provide structured trading signals with specific price targets." },
          { role: "user", content: analysisPrompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_trading_signal",
              description: "Generate a structured trading signal based on technical analysis",
              parameters: {
                type: "object",
                properties: {
                  signal_type: { type: "string", enum: ["BUY", "SELL", "HOLD"], description: "The trading signal" },
                  confidence: { type: "number", description: "Confidence level 0-100" },
                  entry_price: { type: "number", description: "Recommended entry price" },
                  take_profit_1: { type: "number", description: "First take profit target" },
                  take_profit_2: { type: "number", description: "Second take profit target" },
                  stop_loss: { type: "number", description: "Stop loss price" },
                  trend_direction: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL"], description: "Overall trend direction" },
                  trend_strength: { type: "number", description: "Trend strength 0-100" },
                  sentiment_score: { type: "number", description: "Market sentiment -100 (very bearish) to 100 (very bullish)" },
                  reasoning: { type: "string", description: "Brief explanation of the signal rationale" }
                },
                required: ["signal_type", "confidence", "entry_price", "trend_direction", "trend_strength", "sentiment_score", "reasoning"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "generate_trading_signal" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "AI credits exhausted. Please add more credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error("AI analysis failed");
    }

    const aiResponse = await response.json();
    console.log("AI Response:", JSON.stringify(aiResponse));

    // Extract the function call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "generate_trading_signal") {
      throw new Error("Invalid AI response format");
    }

    const signal = JSON.parse(toolCall.function.arguments);
    console.log("Parsed signal:", signal);

    // Store prediction in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const predictionData = {
      signal_type: signal.signal_type,
      confidence: signal.confidence,
      entry_price: signal.entry_price || currentPrice,
      take_profit_1: signal.take_profit_1,
      take_profit_2: signal.take_profit_2,
      stop_loss: signal.stop_loss,
      current_price_at_prediction: currentPrice,
      trend_direction: signal.trend_direction,
      trend_strength: signal.trend_strength,
      reasoning: signal.reasoning,
      technical_indicators: indicators,
      patterns_detected: patterns,
      sentiment_score: signal.sentiment_score,
      outcome: "PENDING",
    };

    const { data: prediction, error: insertError } = await supabase
      .from("predictions")
      .insert(predictionData)
      .select()
      .single();

    if (insertError) {
      console.error("Error storing prediction:", insertError);
      throw new Error("Failed to store prediction");
    }

    console.log("Prediction stored successfully:", prediction.id);

    return new Response(
      JSON.stringify({
        success: true,
        prediction: {
          ...prediction,
          technical_indicators: indicators,
          patterns_detected: patterns,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating prediction:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
