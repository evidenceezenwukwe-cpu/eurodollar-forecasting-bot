import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Opportunity {
  id: string;
  signal_type: string;
  entry_price: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  patterns_detected: string[] | null;
  technical_indicators: Record<string, any> | null;
  reasoning: string | null;
  confidence: number;
  created_at: string;
  expires_at: string;
  notification_sent_at: string | null;
  symbol: string;
}

interface PricePoint {
  timestamp: string;
  high: number;
  low: number;
  close: number;
}

interface LearningResult {
  lesson: string;
  successFactors: string | null;
  failureReason: string | null;
  confidenceAdjustment: string | null;
}

// Create a hash for pattern context to detect duplicates
function createPatternHash(patterns: string[], signalType: string): string {
  const sortedPatterns = [...patterns].sort().join('|');
  return `${signalType}:${sortedPatterns}`;
}

// Determine outcome by checking if entry was reached, THEN if SL or TP was hit
function evaluateOutcome(
  opportunity: Opportunity,
  priceHistory: PricePoint[],
  isExpired: boolean,
  expiresAt: string
): { outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING'; outcomePrice: number; outcomeAt: string; triggeredAt: string | null } {
  const { signal_type, entry_price, stop_loss, take_profit_1 } = opportunity;
  
  let entryTriggered = false;
  let triggeredAt: string | null = null;
  const expiryTime = new Date(expiresAt).getTime();

  for (const point of priceHistory) {
    const pointTime = new Date(point.timestamp).getTime();

    // Step 1: Check if entry price was actually reached (trade triggered)
    if (!entryTriggered) {
      // Stop looking for entry if this candle is past expiry
      if (pointTime > expiryTime) {
        break; // Entry never reached before expiry
      }
      if (signal_type === 'BUY' && point.low <= entry_price) {
        // Price dipped to or below entry — BUY order would have filled
        entryTriggered = true;
        triggeredAt = point.timestamp;
      } else if (signal_type === 'SELL' && point.high >= entry_price) {
        // Price rose to or above entry — SELL order would have filled
        entryTriggered = true;
        triggeredAt = point.timestamp;
      }
      // If entry not yet triggered on this candle, skip SL/TP checks
      if (!entryTriggered) continue;
    }

    // Step 2: Entry is triggered — now check SL/TP
    if (signal_type === 'BUY') {
      // Check if stop loss was hit first
      if (stop_loss && point.low <= stop_loss) {
        return { outcome: 'LOSS', outcomePrice: stop_loss, outcomeAt: point.timestamp, triggeredAt };
      }
      // Check if take profit was hit
      if (take_profit_1 && point.high >= take_profit_1) {
        return { outcome: 'WIN', outcomePrice: take_profit_1, outcomeAt: point.timestamp, triggeredAt };
      }
    } else if (signal_type === 'SELL') {
      // Check if stop loss was hit first
      if (stop_loss && point.high >= stop_loss) {
        return { outcome: 'LOSS', outcomePrice: stop_loss, outcomeAt: point.timestamp, triggeredAt };
      }
      // Check if take profit was hit
      if (take_profit_1 && point.low <= take_profit_1) {
        return { outcome: 'WIN', outcomePrice: take_profit_1, outcomeAt: point.timestamp, triggeredAt };
      }
    }
  }
  
  // Neither SL nor TP was hit
  const lastPrice = priceHistory[priceHistory.length - 1]?.close || entry_price;
  
  if (isExpired) {
    // If entry was never triggered, it's EXPIRED (never entered the trade)
    // If entry was triggered but SL/TP never hit, also EXPIRED
    return { 
      outcome: 'EXPIRED', 
      outcomePrice: lastPrice, 
      outcomeAt: new Date().toISOString(),
      triggeredAt
    };
  }
  
  // Still active and no SL/TP hit - return PENDING to skip processing
  return { 
    outcome: 'PENDING', 
    outcomePrice: lastPrice, 
    outcomeAt: '',
    triggeredAt
  };
}

// Generate AI learning from the outcome with improved prompt
async function generateLearning(
  opportunity: Opportunity,
  outcome: 'WIN' | 'LOSS' | 'EXPIRED',
  outcomePrice: number,
  lovableApiKey: string,
  existingLearningsCount: number
): Promise<LearningResult> {
  const patterns = opportunity.patterns_detected || [];
  const indicators = opportunity.technical_indicators || {};
  const pipsMove = Math.abs(outcomePrice - opportunity.entry_price) * 10000;
  
  // Improved, more specific prompt
  const prompt = `You are analyzing a completed EUR/USD forex trade to extract a UNIQUE, SPECIFIC learning.

TRADE DETAILS:
- Signal: ${opportunity.signal_type} at ${opportunity.entry_price.toFixed(5)}
- Stop Loss: ${opportunity.stop_loss?.toFixed(5) || 'Not set'}
- Take Profit: ${opportunity.take_profit_1?.toFixed(5) || 'Not set'}
- Confidence: ${opportunity.confidence.toFixed(0)}%
- Result: ${outcome} (${outcome === 'WIN' ? 'TP hit' : outcome === 'LOSS' ? 'SL hit' : 'expired without hitting levels'})
- Outcome Price: ${outcomePrice.toFixed(5)}
- Price Movement: ${pipsMove.toFixed(1)} pips ${outcomePrice > opportunity.entry_price ? 'up' : 'down'}

PATTERNS DETECTED: ${patterns.length > 0 ? patterns.join(', ') : 'None'}

TECHNICAL SNAPSHOT AT ENTRY:
- RSI: ${indicators?.rsi?.toFixed(1) || 'N/A'}
- MACD Histogram: ${indicators?.macd?.histogram?.toFixed(5) || 'N/A'}
- Stochastic %K: ${indicators?.stochastic?.k?.toFixed(1) || 'N/A'}
- ATR: ${indicators?.atr?.toFixed(5) || 'N/A'}

IMPORTANT CONTEXT:
- There are already ${existingLearningsCount} learnings in the database
- We need a NEW, SPECIFIC insight - NOT generic advice like "downtrend = good for SELL"
- Focus on the SPECIFIC numbers and conditions of THIS trade

Respond in EXACTLY this JSON format (no markdown, just raw JSON):
{
  "unique_observation": "One specific thing noticed in THIS trade only (max 25 words)",
  "actionable_rule": "If [specific condition with numbers], then [specific action] (max 30 words)",
  "confidence_adjustment": "Adjust confidence by X% for similar setups because [specific reason]"
}

Examples of GOOD responses:
- "RSI at 28.3 combined with MACD histogram -0.00045 led to 15 pip reversal within 2 hours"
- "If RSI < 30 AND Stochastic %K < 20, increase confidence by +8% for BUY signals"

Examples of BAD responses (too generic):
- "Downtrend patterns work well for SELL signals"
- "Technical indicators aligned correctly"

DO NOT give generic advice. Reference THIS trade's specific numbers.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { 
            role: "system", 
            content: "You are a forex trading analyst. Provide concise, specific, data-driven insights. Always respond in valid JSON format only - no markdown code blocks, no extra text." 
          },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error("AI API error:", response.status);
      return createFallbackLearning(opportunity, outcome, outcomePrice, pipsMove);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Try to parse as JSON first
    try {
      // Clean the content - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();
      
      const parsed = JSON.parse(cleanContent);
      
      return {
        lesson: parsed.unique_observation || `${outcome}: ${opportunity.signal_type} moved ${pipsMove.toFixed(1)} pips`,
        successFactors: outcome === 'WIN' ? parsed.actionable_rule : null,
        failureReason: outcome !== 'WIN' ? parsed.actionable_rule : null,
        confidenceAdjustment: parsed.confidence_adjustment || null
      };
    } catch (parseError) {
      console.log("Failed to parse JSON, using text extraction:", parseError);
      
      // Fallback: extract meaningful content from unstructured response
      const lines = content.split('\n').filter((l: string) => l.trim() && !l.includes('{') && !l.includes('}'));
      const meaningfulLine = lines.find((l: string) => l.length > 20) || lines[0] || '';
      
      return {
        lesson: meaningfulLine.slice(0, 500) || `${outcome}: ${opportunity.signal_type} at RSI ${indicators?.rsi?.toFixed(1) || 'N/A'} moved ${pipsMove.toFixed(1)} pips`,
        successFactors: outcome === 'WIN' ? `Trade succeeded with ${patterns.join(', ') || 'technical'} setup` : null,
        failureReason: outcome !== 'WIN' ? `Trade failed despite ${opportunity.confidence.toFixed(0)}% confidence` : null,
        confidenceAdjustment: null
      };
    }
  } catch (error) {
    console.error("Learning generation error:", error);
    return createFallbackLearning(opportunity, outcome, outcomePrice, pipsMove);
  }
}

// Create a specific fallback learning
function createFallbackLearning(
  opportunity: Opportunity,
  outcome: 'WIN' | 'LOSS' | 'EXPIRED',
  outcomePrice: number,
  pipsMove: number
): LearningResult {
  const indicators = opportunity.technical_indicators || {};
  const patterns = opportunity.patterns_detected || [];
  
  return {
    lesson: `${outcome}: ${opportunity.signal_type} at ${opportunity.entry_price.toFixed(5)} (RSI: ${indicators?.rsi?.toFixed(1) || 'N/A'}) moved ${pipsMove.toFixed(1)} pips`,
    successFactors: outcome === 'WIN' 
      ? `${patterns.join(' + ') || 'Technical setup'} at ${opportunity.confidence.toFixed(0)}% confidence reached TP` 
      : null,
    failureReason: outcome !== 'WIN' 
      ? `${outcome === 'LOSS' ? 'SL hit' : 'Expired'} after ${pipsMove.toFixed(1)} pip move against position` 
      : null,
    confidenceAdjustment: null
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting opportunity evaluation...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // Find ALL opportunities that need evaluation (both active and expired)
    // This includes ACTIVE ones that may have hit SL/TP
    const { data: pendingOpps, error: fetchError } = await supabase
      .from('trading_opportunities')
      .select('*')
      .is('outcome', null)
      .in('status', ['ACTIVE', 'EXPIRED'])
      .limit(20);

    if (fetchError) {
      console.error("Fetch error:", fetchError);
      throw new Error("Failed to fetch pending opportunities");
    }

    if (!pendingOpps || pendingOpps.length === 0) {
      console.log("No pending opportunities to evaluate");
      return new Response(
        JSON.stringify({ success: true, message: "No pending opportunities", evaluated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${pendingOpps.length} opportunities to evaluate`);

    // Get count of existing learnings for context
    const { count: existingLearningsCount } = await supabase
      .from('prediction_learnings')
      .select('*', { count: 'exact', head: true });

    const results: any[] = [];

    for (const opp of pendingOpps) {
      console.log(`Evaluating opportunity ${opp.id}...`);

      // Fetch price history since the opportunity was created (use the opportunity's symbol)
      const opportunitySymbol = opp.symbol || 'EUR/USD';
      const nowISO = new Date().toISOString();
      const { data: priceHistory, error: priceError } = await supabase
        .from('price_history')
        .select('timestamp, high, low, close')
        .eq('symbol', opportunitySymbol)
        .eq('timeframe', '15min')
        .gte('timestamp', opp.created_at)
        .lte('timestamp', nowISO)
        .order('timestamp', { ascending: true });

      if (priceError || !priceHistory || priceHistory.length === 0) {
        console.log(`No price history for opportunity ${opp.id}`);
        continue;
      }

      // Check if opportunity has expired
      const isExpired = new Date(opp.expires_at) < new Date();
      
      // Evaluate outcome
      const { outcome, outcomePrice, outcomeAt, triggeredAt } = evaluateOutcome(
        opp as Opportunity,
        priceHistory.map(p => ({
          timestamp: p.timestamp,
          high: Number(p.high),
          low: Number(p.low),
          close: Number(p.close)
        })),
        isExpired
      );

      // If entry was triggered, update triggered_at on the opportunity
      if (triggeredAt && !opp.triggered_at) {
        await supabase
          .from('trading_opportunities')
          .update({ triggered_at: triggeredAt })
          .eq('id', opp.id);
      }

      // Skip if still active and no SL/TP hit yet
      if (outcome === 'PENDING') {
        console.log(`Opportunity ${opp.id}: still PENDING (no SL/TP hit, not expired)`);
        continue;
      }

      console.log(`Opportunity ${opp.id}: ${outcome} at ${outcomePrice}`);

      // Create pattern hash for deduplication
      const patternHash = createPatternHash(
        opp.patterns_detected || [], 
        opp.signal_type
      );

      // Check for similar recent learnings to avoid duplicates
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSimilarLearnings } = await supabase
        .from('prediction_learnings')
        .select('id, lesson_extracted, pattern_context')
        .gte('created_at', twentyFourHoursAgo);

      // Check if we have a very similar learning already
      const hasSimilar = recentSimilarLearnings?.some(learning => {
        const ctx = learning.pattern_context as any;
        if (!ctx) return false;
        const existingHash = createPatternHash(ctx.patterns || [], ctx.signal_type || '');
        return existingHash === patternHash && ctx.outcome === outcome;
      });

      if (hasSimilar) {
        console.log(`Skipping learning generation for ${opp.id} - similar learning exists`);
        
        // Still update the opportunity outcome, but skip learning generation
        // Use .select() to verify rows were actually updated
        const { data: updatedOpp, error: skipUpdateError } = await supabase
          .from('trading_opportunities')
          .update({
            outcome,
            status: outcome === 'WIN' ? 'COMPLETED' : 'CLOSED',
            evaluated_at: new Date().toISOString()
          })
          .eq('id', opp.id)
          .select()
          .single();

        if (skipUpdateError || !updatedOpp) {
          console.error(`Failed to update opportunity ${opp.id} in skip path:`, skipUpdateError || 'No rows updated');
          console.error(`Update attempted with: outcome=${outcome}, id=${opp.id}`);
          continue; // Skip to next opportunity, don't send duplicate notifications
        }
        
        console.log(`Successfully updated opportunity ${opp.id} to ${outcome} in skip path`);

        // Send Telegram notification if not already sent
        if (!opp.notification_sent_at) {
          try {
            const telegramPayload = {
              type: 'outcome',
              signal_type: opp.signal_type,
              outcome: outcome as 'WIN' | 'LOSS' | 'EXPIRED',
              confidence: opp.confidence,
              entry_price: opp.entry_price,
              outcome_price: outcomePrice,
              stop_loss: opp.stop_loss,
              take_profit_1: opp.take_profit_1,
              created_at: opp.created_at,
              symbol: opp.symbol || 'EUR/USD',
              reasoning: opp.reasoning,
              learning_summary: 'Similar pattern analyzed recently - see previous insights',
              patterns_detected: opp.patterns_detected || []
            };
            
            console.log("Sending Telegram outcome notification (skip path) for opportunity:", opp.id);
            
            const telegramResponse = await fetch(
              `${supabaseUrl}/functions/v1/send-telegram-notification`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseKey}`
                },
                body: JSON.stringify(telegramPayload)
              }
            );
            
            if (telegramResponse.ok) {
              // Mark notification as sent
              await supabase
                .from('trading_opportunities')
                .update({ notification_sent_at: new Date().toISOString() })
                .eq('id', opp.id);
              console.log("Telegram outcome notification sent successfully (skip path)");
            } else {
              const errorText = await telegramResponse.text();
              console.error("Failed to send Telegram notification (skip path):", errorText);
            }
          } catch (telegramError) {
            console.error("Error sending Telegram notification (skip path):", telegramError);
          }
        } else {
          console.log(`Skipping Telegram notification for ${opp.id} - already sent at ${opp.notification_sent_at}`);
        }

        results.push({
          id: opp.id,
          outcome,
          outcomePrice,
          learning: 'Skipped - similar learning exists',
          skipped: true
        });
        continue;
      }

      // Generate learning using AI
      let learning: LearningResult;
      
      // At this point, outcome is definitely WIN, LOSS, or EXPIRED (PENDING was skipped above)
      const finalOutcome = outcome as 'WIN' | 'LOSS' | 'EXPIRED';
      
      if (lovableApiKey) {
        learning = await generateLearning(
          opp as Opportunity, 
          finalOutcome, 
          outcomePrice, 
          lovableApiKey,
          existingLearningsCount || 0
        );
      } else {
        learning = createFallbackLearning(
          opp as Opportunity,
          finalOutcome,
          outcomePrice,
          Math.abs(outcomePrice - opp.entry_price) * 10000
        );
      }

      // Store learning with enhanced pattern context
      const { data: newLearning, error: learningError } = await supabase
        .from('prediction_learnings')
        .insert({
          opportunity_id: opp.id,
          lesson_extracted: learning.lesson,
          success_factors: learning.successFactors,
          failure_reason: learning.failureReason,
          pattern_context: {
            patterns: opp.patterns_detected || [],
            indicators: {
              rsi: opp.technical_indicators?.rsi,
              macd_histogram: opp.technical_indicators?.macd?.histogram,
              stochastic_k: opp.technical_indicators?.stochastic?.k,
              atr: opp.technical_indicators?.atr
            },
            signal_type: opp.signal_type,
            confidence: opp.confidence,
            outcome: outcome,
            confidence_adjustment: learning.confidenceAdjustment
          },
          market_conditions: {
            entry_price: opp.entry_price,
            outcome_price: outcomePrice,
            pips_moved: Math.abs(outcomePrice - opp.entry_price) * 10000,
            trend_direction: opp.signal_type,
            trend_strength: opp.confidence,
            sentiment_score: 0
          }
        })
        .select()
        .single();

      if (learningError) {
        console.error("Failed to store learning:", learningError);
      }

      // Update opportunity with .select() to verify rows were actually updated
      const { data: updatedMainOpp, error: updateError } = await supabase
        .from('trading_opportunities')
        .update({
          outcome,
          status: outcome === 'WIN' ? 'COMPLETED' : 'CLOSED',
          evaluated_at: new Date().toISOString(),
          ai_learning_id: newLearning?.id || null
        })
        .eq('id', opp.id)
        .select()
        .single();

      if (updateError || !updatedMainOpp) {
        console.error("Failed to update opportunity:", updateError || 'No rows updated');
        console.error(`Update attempted with: outcome=${outcome}, id=${opp.id}`);
        continue; // Skip to next opportunity
      }
      
      console.log(`Successfully updated opportunity ${opp.id} to ${outcome} in main path`);

      // Send Telegram notification for trade outcome (only if not already sent)
      if (!opp.notification_sent_at) {
        try {
          const telegramPayload = {
            type: 'outcome',
            signal_type: opp.signal_type,
            outcome: finalOutcome,
            confidence: opp.confidence,
            entry_price: opp.entry_price,
            outcome_price: outcomePrice,
            stop_loss: opp.stop_loss,
            take_profit_1: opp.take_profit_1,
            created_at: opp.created_at,
            symbol: opp.symbol || 'EUR/USD',
            reasoning: opp.reasoning,
            learning_summary: learning.lesson,
            patterns_detected: opp.patterns_detected || []
          };
          
          console.log("Sending Telegram outcome notification for opportunity:", opp.id);
          
          const telegramResponse = await fetch(
            `${supabaseUrl}/functions/v1/send-telegram-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseKey}`
              },
              body: JSON.stringify(telegramPayload)
            }
          );
          
          if (telegramResponse.ok) {
            // Mark notification as sent
            await supabase
              .from('trading_opportunities')
              .update({ notification_sent_at: new Date().toISOString() })
              .eq('id', opp.id);
            console.log("Telegram outcome notification sent successfully");
          } else {
            const errorText = await telegramResponse.text();
            console.error("Failed to send Telegram notification:", errorText);
          }
        } catch (telegramError) {
          console.error("Error sending Telegram notification:", telegramError);
        }
      } else {
        console.log(`Skipping Telegram notification for ${opp.id} - already sent at ${opp.notification_sent_at}`);
      }

      // Real-time increment pattern_metrics
      try {
        const oppPatterns: string[] = Array.isArray(opp.patterns_detected) ? opp.patterns_detected : [];
        const oppSymbol = opp.symbol || 'EUR/USD';
        const pipDiv = oppSymbol.includes('JPY') ? 0.01 : 0.0001;
        const oppPips = opp.take_profit_1 && opp.stop_loss
          ? finalOutcome === 'WIN'
            ? Math.abs(opp.take_profit_1 - opp.entry_price) / pipDiv
            : Math.abs(opp.entry_price - opp.stop_loss) / pipDiv * -1
          : 0;

        // Determine session from created_at
        const createdDate = new Date(opp.created_at);
        const h = createdDate.getUTCHours();
        const t = h * 60 + createdDate.getUTCMinutes();
        const oppSession = (t >= 23 * 60 || t < 8 * 60) ? 'ASIA' : (t >= 7 * 60 && t < 16 * 60) ? 'LONDON' : (t >= 12 * 60 && t < 21 * 60) ? 'NEWYORK' : 'OTHER';

        for (const pattern of oppPatterns) {
          for (const sess of [oppSession, 'ALL']) {
            // Fetch existing row
            const { data: existing } = await supabase
              .from('pattern_metrics')
              .select('*')
              .eq('pattern_name', pattern)
              .eq('symbol', oppSymbol)
              .eq('timeframe', '1h')
              .eq('session', sess)
              .maybeSingle();

            const prevWins = existing?.wins || 0;
            const prevLosses = existing?.losses || 0;
            const prevPips = (existing?.avg_pips || 0) * (prevWins + prevLosses);
            const newWins = prevWins + (finalOutcome === 'WIN' ? 1 : 0);
            const newLosses = prevLosses + (finalOutcome !== 'WIN' ? 1 : 0);
            const newTotal = newWins + newLosses;
            const newAvgPips = newTotal > 0 ? Math.round(((prevPips + oppPips) / newTotal) * 10) / 10 : 0;
            const newWinRate = newTotal > 0 ? Math.round((newWins / newTotal) * 10000) / 100 : 0;

            const recentArr = Array.isArray(existing?.recent_results) ? [...(existing.recent_results as any[])] : [];
            recentArr.unshift({ outcome: finalOutcome, pips: Math.round(oppPips * 10) / 10, date: opp.created_at });
            if (recentArr.length > 10) recentArr.length = 10;

            await supabase
              .from('pattern_metrics')
              .upsert({
                pattern_name: pattern,
                symbol: oppSymbol,
                timeframe: '1h',
                session: sess,
                wins: newWins,
                losses: newLosses,
                trades_count: newTotal,
                win_rate: newWinRate,
                avg_pips: newAvgPips,
                profit_factor: existing?.profit_factor || 0,
                avg_rr: existing?.avg_rr || 0,
                recent_results: recentArr,
                last_updated: new Date().toISOString(),
              }, { onConflict: 'pattern_name,symbol,timeframe,session' });
          }
        }
        console.log(`Incremented pattern_metrics for ${oppPatterns.length} patterns`);
      } catch (metricsErr) {
        console.error('Failed to increment pattern_metrics:', metricsErr);
      }

      results.push({
        id: opp.id,
        outcome,
        outcomePrice,
        learning: learning.lesson,
        skipped: false
      });
    }

    console.log(`Evaluated ${results.length} opportunities`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Evaluated ${results.length} opportunities`,
        evaluated: results.length,
        newLearnings: results.filter(r => !r.skipped).length,
        skipped: results.filter(r => r.skipped).length,
        results 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Evaluation error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
