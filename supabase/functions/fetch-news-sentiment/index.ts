import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Analyzing forex market sentiment...");

    // Use AI to generate market sentiment analysis
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { 
            role: "system", 
            content: "You are a forex market analyst. Provide current market sentiment analysis for EUR/USD based on typical market factors. Generate realistic but fictional news headlines and sentiment scores for a trading dashboard demo." 
          },
          { 
            role: "user", 
            content: "Generate 5 recent fictional but realistic forex news headlines about EUR/USD and provide an overall market sentiment analysis. Include ECB/Fed policy news, economic data releases, and geopolitical factors." 
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_sentiment",
              description: "Provide market sentiment analysis with news headlines",
              parameters: {
                type: "object",
                properties: {
                  overall_sentiment: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL"] },
                  sentiment_score: { type: "number", description: "-100 to 100 scale" },
                  summary: { type: "string", description: "Brief market summary (2-3 sentences)" },
                  news_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        headline: { type: "string" },
                        source: { type: "string" },
                        sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
                        impact: { type: "string", enum: ["high", "medium", "low"] }
                      },
                      required: ["headline", "source", "sentiment", "impact"]
                    }
                  },
                  key_factors: {
                    type: "array",
                    items: { type: "string" },
                    description: "Key factors affecting EUR/USD"
                  }
                },
                required: ["overall_sentiment", "sentiment_score", "summary", "news_items", "key_factors"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "analyze_sentiment" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error("Failed to analyze sentiment");
    }

    const aiResponse = await response.json();
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall || toolCall.function.name !== "analyze_sentiment") {
      throw new Error("Invalid AI response format");
    }

    const sentiment = JSON.parse(toolCall.function.arguments);
    console.log("Sentiment analysis complete:", sentiment.overall_sentiment);

    return new Response(
      JSON.stringify({
        success: true,
        sentiment: {
          ...sentiment,
          generated_at: new Date().toISOString(),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching sentiment:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
