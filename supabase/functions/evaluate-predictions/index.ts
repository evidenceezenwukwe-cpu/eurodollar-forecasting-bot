import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fetch current price from cached price_history table (no API call needed)
async function fetchCurrentPriceFromCache(supabase: any, symbol: string = 'EUR/USD'): Promise<number | null> {
  const { data, error } = await supabase
    .from('price_history')
    .select('close, timestamp')
    .eq('symbol', symbol)
    .eq('timeframe', '15min')
    .lte('timestamp', new Date().toISOString())
    .order('timestamp', { ascending: false })
    .limit(1);
  
  if (error || !data || data.length === 0) {
    console.log(`No cached price found for ${symbol}`);
    return null;
  }
  
  console.log(`Using cached price for ${symbol}: ${data[0].close} from ${data[0].timestamp}`);
  return parseFloat(data[0].close);
}

// Fetch price history from cached data since a given time
async function fetchPriceHistoryFromCache(
  supabase: any, 
  since: Date, 
  symbol: string = 'EUR/USD'
): Promise<{ high: number; low: number; current: number } | null> {
  const now = new Date();
  
  const { data, error } = await supabase
    .from('price_history')
    .select('high, low, close, timestamp')
    .eq('symbol', symbol)
    .eq('timeframe', '15min')
    .gte('timestamp', since.toISOString())
    .lte('timestamp', now.toISOString())
    .order('timestamp', { ascending: false })
    .limit(500);
  
  if (error || !data || data.length === 0) {
    console.log(`No cached price history found for ${symbol} since ${since.toISOString()}`);
    return null;
  }
  
  let high = -Infinity;
  let low = Infinity;
  
  for (const candle of data) {
    const candleHigh = parseFloat(candle.high);
    const candleLow = parseFloat(candle.low);
    if (candleHigh > high) high = candleHigh;
    if (candleLow < low) low = candleLow;
  }
  
  const current = parseFloat(data[0].close);
  console.log(`Cached price history for ${symbol}: ${data.length} candles, High=${high.toFixed(5)}, Low=${low.toFixed(5)}, Current=${current.toFixed(5)}`);
  
  return { high, low, current };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Try to get price from request body, otherwise fetch it
    let currentPrice: number;
    
    try {
      const body = await req.json();
      currentPrice = body.currentPrice;
    } catch {
      currentPrice = 0;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    if (!currentPrice || typeof currentPrice !== 'number') {
      console.log('No price provided, fetching from cache...');
      const cached = await fetchCurrentPriceFromCache(supabase);
      if (cached) {
        currentPrice = cached;
      } else {
        throw new Error('No cached price available for evaluation');
      }
    }

    console.log(`Evaluating predictions against current price: ${currentPrice}`);

    // Fetch pending predictions (no outcome yet)
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('predictions')
      .select('*')
      .is('outcome', null)
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch predictions: ${fetchError.message}`);
    }

    console.log(`Found ${pendingPredictions?.length || 0} pending predictions to evaluate`);

    const evaluatedPredictions: any[] = [];
    const learnings: any[] = [];
    const now = new Date();

    for (const prediction of pendingPredictions || []) {
      const createdAt = new Date(prediction.created_at);
      const expiresAt = new Date(prediction.expires_at);
      const isExpired = now > expiresAt;
      
      // Fetch price history from cache since prediction was made
      let priceHistory: { high: number; low: number; current: number };
      const cachedHistory = await fetchPriceHistoryFromCache(supabase, createdAt);
      if (cachedHistory) {
        priceHistory = cachedHistory;
        console.log(`Price history for prediction ${prediction.id}: High=${priceHistory.high.toFixed(5)}, Low=${priceHistory.low.toFixed(5)}, Current=${priceHistory.current.toFixed(5)}`);
      } else {
        console.log(`No cached history for prediction ${prediction.id}, using current price`);
        priceHistory = { high: currentPrice, low: currentPrice, current: currentPrice };
      }
      
      let outcome: 'WIN' | 'LOSS' | null = null;
      let failureReason: string | null = null;
      let successFactors: string | null = null;

      if (prediction.signal_type === 'BUY') {
        // Check if TP1 or TP2 was EVER hit during the trade (using high)
        if (priceHistory.high >= prediction.take_profit_1) {
          outcome = 'WIN';
          successFactors = priceHistory.high >= (prediction.take_profit_2 || prediction.take_profit_1) 
            ? 'Hit TP2 - Strong momentum continuation' 
            : 'Hit TP1 - Primary target reached';
        } 
        // Check if SL was EVER hit (using low)
        else if (priceHistory.low <= prediction.stop_loss) {
          outcome = 'LOSS';
          failureReason = 'Stop loss hit - Price reversed against position';
        }
        // Check if expired without hitting targets
        else if (isExpired) {
          if (priceHistory.current > prediction.entry_price) {
            outcome = 'WIN';
            successFactors = 'Expired in profit - Partial target achieved';
          } else {
            outcome = 'LOSS';
            failureReason = 'Expired below entry - Momentum failed to materialize';
          }
        }
      } else if (prediction.signal_type === 'SELL') {
        // Check if TP1 or TP2 was EVER hit during the trade (using low)
        if (priceHistory.low <= prediction.take_profit_1) {
          outcome = 'WIN';
          successFactors = priceHistory.low <= (prediction.take_profit_2 || prediction.take_profit_1)
            ? 'Hit TP2 - Strong bearish continuation'
            : 'Hit TP1 - Primary target reached';
        }
        // Check if SL was EVER hit (using high)
        else if (priceHistory.high >= prediction.stop_loss) {
          outcome = 'LOSS';
          failureReason = 'Stop loss hit - Price reversed against position';
        }
        // Check if expired without hitting targets
        else if (isExpired) {
          if (priceHistory.current < prediction.entry_price) {
            outcome = 'WIN';
            successFactors = 'Expired in profit - Partial target achieved';
          } else {
            outcome = 'LOSS';
            failureReason = 'Expired above entry - Bearish momentum failed';
          }
        }
      }

      // Update prediction if outcome determined
      if (outcome) {
        const { error: updateError } = await supabase
          .from('predictions')
          .update({
            outcome,
            outcome_price: priceHistory.current,
            outcome_at: now.toISOString()
          })
          .eq('id', prediction.id);

        if (updateError) {
          console.error(`Failed to update prediction ${prediction.id}:`, updateError);
          continue;
        }

        evaluatedPredictions.push({
          id: prediction.id,
          signal_type: prediction.signal_type,
          outcome,
          entry_price: prediction.entry_price,
          outcome_price: priceHistory.current,
          high_reached: priceHistory.high,
          low_reached: priceHistory.low
        });

        // Extract learning from this prediction
        const patternContext = {
          patterns: prediction.patterns_detected,
          indicators: prediction.technical_indicators,
          signal_type: prediction.signal_type,
          confidence: prediction.confidence
        };

        const marketConditions = {
          entry_price: prediction.entry_price,
          outcome_price: priceHistory.current,
          high_reached: priceHistory.high,
          low_reached: priceHistory.low,
          trend_direction: prediction.trend_direction,
          trend_strength: prediction.trend_strength,
          sentiment_score: prediction.sentiment_score
        };

        let lessonExtracted = '';
        if (outcome === 'LOSS') {
          const indicators = prediction.technical_indicators as any;
          
          if (prediction.signal_type === 'BUY' && indicators?.rsi > 70) {
            lessonExtracted = 'Avoid BUY signals when RSI is in overbought territory (>70)';
          } else if (prediction.signal_type === 'SELL' && indicators?.rsi < 30) {
            lessonExtracted = 'Avoid SELL signals when RSI is in oversold territory (<30)';
          } else if (prediction.signal_type === 'BUY' && priceHistory.current < indicators?.ema50) {
            lessonExtracted = 'BUY signal failed when price was below EMA50 - wait for price to reclaim EMA';
          } else if (prediction.signal_type === 'SELL' && priceHistory.current > indicators?.ema50) {
            lessonExtracted = 'SELL signal failed when price was above EMA50 - wait for breakdown';
          } else {
            lessonExtracted = `${prediction.signal_type} signal at ${prediction.entry_price} failed. SL hit at ${priceHistory.high >= prediction.stop_loss ? priceHistory.high.toFixed(5) : priceHistory.low.toFixed(5)}`;
          }
        } else {
          lessonExtracted = `${prediction.signal_type} signal succeeded. TP hit at ${prediction.signal_type === 'BUY' ? priceHistory.high.toFixed(5) : priceHistory.low.toFixed(5)}. Pattern: ${(prediction.patterns_detected as string[])?.join(', ') || 'N/A'}`;
        }

        // Store learning
        const { error: learningError } = await supabase
          .from('prediction_learnings')
          .insert({
            prediction_id: prediction.id,
            pattern_context: patternContext,
            market_conditions: marketConditions,
            lesson_extracted: lessonExtracted,
            failure_reason: failureReason,
            success_factors: successFactors
          });

        if (learningError) {
          console.error(`Failed to store learning for ${prediction.id}:`, learningError);
        } else {
          learnings.push({
            prediction_id: prediction.id,
            lesson: lessonExtracted
          });
        }

        // Send Telegram notification for prediction outcome
        try {
          const telegramPayload = {
            type: 'outcome',
            signal_type: prediction.signal_type,
            outcome: outcome,
            confidence: prediction.confidence,
            entry_price: prediction.entry_price,
            outcome_price: priceHistory.current,
            stop_loss: prediction.stop_loss,
            take_profit_1: prediction.take_profit_1,
            created_at: prediction.created_at,
            symbol: 'EUR/USD', // Predictions table is EUR/USD only
            reasoning: prediction.reasoning,
            learning_summary: lessonExtracted,
            patterns_detected: prediction.patterns_detected
          };

          const telegramResponse = await fetch(
            `${supabaseUrl}/functions/v1/send-telegram-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify(telegramPayload)
            }
          );

          if (telegramResponse.ok) {
            console.log(`Telegram notification sent for prediction ${prediction.id} (${outcome})`);
          } else {
            const errText = await telegramResponse.text();
            console.error(`Failed to send Telegram notification: ${errText}`);
          }
        } catch (telegramError) {
          console.error(`Telegram notification error for prediction ${prediction.id}:`, telegramError);
        }
      }
    }

    console.log(`Evaluated ${evaluatedPredictions.length} predictions, extracted ${learnings.length} learnings`);

    return new Response(JSON.stringify({
      success: true,
      evaluated: evaluatedPredictions.length,
      results: evaluatedPredictions,
      learnings
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error evaluating predictions:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});