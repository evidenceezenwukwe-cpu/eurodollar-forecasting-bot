import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Strategy DSL JSON Schema
const STRATEGY_DSL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Strategy name" },
    description: { type: "string", description: "Human-readable summary" },
    htf_bias: {
      type: "object",
      properties: {
        timeframe: { type: "string", enum: ["1w", "1d"] },
        condition: { type: "string", enum: ["strong_high_rejection", "strong_low_rejection", "bullish_close", "bearish_close", "any"] },
      },
    },
    trigger: {
      type: "object",
      properties: {
        timeframe: { type: "string", enum: ["4h", "1h"] },
        condition: { type: "string", enum: ["sweep_high", "sweep_low", "range_sweep", "break_of_structure", "inducement"] },
        lookback_candles: { type: "number", minimum: 1, maximum: 20 },
      },
      required: ["timeframe", "condition"],
    },
    entry: {
      type: "object",
      properties: {
        timeframe: { type: "string", enum: ["15min", "5min", "1min"] },
        condition: { type: "string", enum: ["bos_bullish", "bos_bearish", "inducement_tap", "fvg_entry", "order_block_entry", "market_order"] },
        confirmation: { type: "string", enum: ["candle_close", "wick_rejection", "none"] },
      },
      required: ["timeframe", "condition"],
    },
    stop: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["swing_low", "swing_high", "atr_multiple", "fixed_pips", "structure_low", "structure_high"] },
        value: { type: "number", description: "ATR multiple or fixed pips value (only for atr_multiple/fixed_pips)" },
        buffer_pips: { type: "number", default: 2 },
      },
      required: ["type"],
    },
    tp: {
      type: "object",
      properties: {
        tp1: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["rr_ratio", "swing_target", "fixed_pips", "fib_extension"] },
            value: { type: "number" },
          },
          required: ["type", "value"],
        },
        tp2: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["rr_ratio", "swing_target", "fixed_pips", "fib_extension"] },
            value: { type: "number" },
          },
        },
      },
      required: ["tp1"],
    },
    filters: {
      type: "object",
      properties: {
        sessions: { type: "array", items: { type: "string", enum: ["london", "newyork", "asia"] } },
        min_spread_pips: { type: "number" },
        max_spread_pips: { type: "number" },
        min_atr: { type: "number" },
        max_atr: { type: "number" },
      },
    },
    expiry_hours: { type: "number", minimum: 1, maximum: 168, default: 24 },
  },
  required: ["name", "trigger", "entry", "stop", "tp"],
};

// Validation rules for safety
function validateDSL(dsl: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!dsl || typeof dsl !== 'object') {
    return { valid: false, errors: ["Parsed result is not a valid object"] };
  }

  // Required fields
  if (!dsl.name || typeof dsl.name !== 'string' || dsl.name.length < 2) {
    errors.push("Strategy must have a name (min 2 chars)");
  }
  if (!dsl.trigger || !dsl.trigger.timeframe || !dsl.trigger.condition) {
    errors.push("Trigger must specify timeframe and condition");
  }
  if (!dsl.entry || !dsl.entry.timeframe || !dsl.entry.condition) {
    errors.push("Entry must specify timeframe and condition");
  }
  if (!dsl.stop || !dsl.stop.type) {
    errors.push("Stop loss must specify a type");
  }
  if (!dsl.tp || !dsl.tp.tp1 || !dsl.tp.tp1.type) {
    errors.push("At least one take profit target is required");
  }

  // Validate enum values
  const validTriggerTfs = ["4h", "1h"];
  const validEntryTfs = ["15min", "5min", "1min"];
  const validTriggerConditions = ["sweep_high", "sweep_low", "range_sweep", "break_of_structure", "inducement"];
  const validEntryConditions = ["bos_bullish", "bos_bearish", "inducement_tap", "fvg_entry", "order_block_entry", "market_order"];
  const validStopTypes = ["swing_low", "swing_high", "atr_multiple", "fixed_pips", "structure_low", "structure_high"];
  const validTPTypes = ["rr_ratio", "swing_target", "fixed_pips", "fib_extension"];

  if (dsl.trigger?.timeframe && !validTriggerTfs.includes(dsl.trigger.timeframe)) {
    errors.push(`Invalid trigger timeframe: ${dsl.trigger.timeframe}. Must be: ${validTriggerTfs.join(", ")}`);
  }
  if (dsl.trigger?.condition && !validTriggerConditions.includes(dsl.trigger.condition)) {
    errors.push(`Invalid trigger condition: ${dsl.trigger.condition}. Must be: ${validTriggerConditions.join(", ")}`);
  }
  if (dsl.entry?.timeframe && !validEntryTfs.includes(dsl.entry.timeframe)) {
    errors.push(`Invalid entry timeframe: ${dsl.entry.timeframe}. Must be: ${validEntryTfs.join(", ")}`);
  }
  if (dsl.entry?.condition && !validEntryConditions.includes(dsl.entry.condition)) {
    errors.push(`Invalid entry condition: ${dsl.entry.condition}. Must be: ${validEntryConditions.join(", ")}`);
  }
  if (dsl.stop?.type && !validStopTypes.includes(dsl.stop.type)) {
    errors.push(`Invalid stop type: ${dsl.stop.type}. Must be: ${validStopTypes.join(", ")}`);
  }
  if (dsl.tp?.tp1?.type && !validTPTypes.includes(dsl.tp.tp1.type)) {
    errors.push(`Invalid TP1 type: ${dsl.tp.tp1.type}. Must be: ${validTPTypes.join(", ")}`);
  }

  // Safety: reject overly vague strategies
  if (dsl.trigger?.condition === "any" || dsl.entry?.condition === "any") {
    errors.push("Strategy conditions cannot be 'any' - be more specific");
  }

  // Sensible limits
  if (dsl.stop?.type === "fixed_pips" && dsl.stop?.value && (dsl.stop.value < 3 || dsl.stop.value > 200)) {
    errors.push("Fixed pip stop must be between 3-200 pips");
  }
  if (dsl.expiry_hours && (dsl.expiry_hours < 1 || dsl.expiry_hours > 168)) {
    errors.push("Expiry must be between 1-168 hours");
  }

  return { valid: errors.length === 0, errors };
}

const SYSTEM_PROMPT = `You are a forex trading strategy parser. Convert natural language strategy descriptions into a structured JSON DSL.

IMPORTANT RULES:
- Only output valid JSON matching the schema below
- Map user concepts to the closest available enum values
- If the user description is too vague or ambiguous (e.g., "enter whenever it looks good"), set confidence to 0 and add validation notes explaining why
- Never invent new condition types - only use the allowed enum values
- Default to conservative settings when unsure

STRATEGY DSL SCHEMA:
${JSON.stringify(STRATEGY_DSL_SCHEMA, null, 2)}

PRIMITIVE MAPPING TABLE (map user language to these):
- "sweep the high" / "liquidity grab above" -> trigger.condition: "sweep_high"
- "sweep the low" / "stop hunt below" -> trigger.condition: "sweep_low"  
- "candle range sweep" / "CRT sweep" -> trigger.condition: "range_sweep"
- "break of structure" / "BOS" / "market structure break" -> "break_of_structure"
- "inducement" / "internal liquidity" -> "inducement"
- "bullish BOS" / "bullish break" -> entry.condition: "bos_bullish"
- "bearish BOS" / "bearish break" -> entry.condition: "bos_bearish"
- "FVG entry" / "fair value gap" -> entry.condition: "fvg_entry"
- "order block" / "OB entry" -> entry.condition: "order_block_entry"
- "below the swing low" -> stop.type: "swing_low"
- "above the swing high" -> stop.type: "swing_high"
- "ATR stop" / "volatility stop" -> stop.type: "atr_multiple"
- "1:2 RR" / "risk reward 2" -> tp.tp1.type: "rr_ratio", tp.tp1.value: 2
- "next swing" / "swing target" -> tp.tp1.type: "swing_target"

RESPONSE FORMAT: Return a JSON object with these fields:
{
  "strategy": { ... the DSL object ... },
  "confidence": 0-100,
  "validation_notes": ["note1", "note2"],
  "human_summary": "Plain English summary of what the strategy does"
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Auth check
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { description } = await req.json();
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return new Response(JSON.stringify({ 
        error: "Strategy description must be at least 10 characters" 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Sanitize input
    const sanitizedDescription = description.trim().slice(0, 2000);

    // Call Lovable AI
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Parse this trading strategy into the DSL format:\n\n"${sanitizedDescription}"` },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const body = await aiResponse.text();
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later" }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.error("AI error:", status, body);
      throw new Error("AI parsing failed");
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");

    // Extract JSON from response (handle markdown code blocks)
    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try direct parse
      try {
        parsed = JSON.parse(content);
      } catch {
        return new Response(JSON.stringify({ 
          error: "Failed to parse AI response",
          raw: content.slice(0, 500),
        }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Validate the parsed DSL
    const strategy = parsed.strategy || parsed;
    const validation = validateDSL(strategy);

    // Reject low confidence or invalid strategies
    const confidence = parsed.confidence ?? (validation.valid ? 75 : 20);
    if (confidence < 30 && !validation.valid) {
      return new Response(JSON.stringify({
        error: "Strategy description is too vague or ambiguous",
        confidence,
        validation_errors: validation.errors,
        validation_notes: parsed.validation_notes || [],
        suggestion: "Try being more specific. Example: 'On H4, wait for a sweep of the previous high, then enter on M15 bullish BOS with stop below swing low and 1:2 RR target'",
      }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      strategy,
      confidence,
      validation: validation,
      validation_notes: parsed.validation_notes || [],
      human_summary: parsed.human_summary || strategy.description || "Strategy parsed successfully",
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error("Parse error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
