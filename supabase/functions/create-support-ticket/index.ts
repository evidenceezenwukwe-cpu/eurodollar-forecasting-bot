import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { title, body, priority } = await req.json();

    if (!title || !body) {
      return new Response(JSON.stringify({ error: "Title and body are required" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if user has funded/lifetime plan
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan_type')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    const isFunded = sub?.plan_type === 'funded' || sub?.plan_type === 'lifetime';
    const ticketPriority = priority || (isFunded ? 'high' : 'normal');

    // Insert ticket
    const { data: ticket, error: insertError } = await supabase
      .from('support_tickets')
      .insert({
        user_id: user.id,
        title,
        body,
        priority: ticketPriority,
        status: 'open',
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // Send Telegram notification for high-priority tickets from funded users
    if (isFunded && ticketPriority === 'high') {
      const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const telegramChannelId = Deno.env.get("TELEGRAM_CHANNEL_ID");

      if (telegramBotToken && telegramChannelId) {
        const message = `
🎫 *HIGH PRIORITY SUPPORT TICKET*

👤 User: ${user.email}
📋 Plan: ${sub?.plan_type?.toUpperCase() || 'N/A'}

📌 *${title}*
${body.slice(0, 300)}${body.length > 300 ? '...' : ''}

🆔 Ticket: \`${ticket.id.slice(0, 8)}\`
⏰ ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC

_Respond within 24h SLA_
        `.trim();

        try {
          await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChannelId,
              text: message,
              parse_mode: 'Markdown',
            }),
          });
        } catch (tgError) {
          console.error("Telegram notification failed:", tgError);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, ticket }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error("Error creating ticket:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
