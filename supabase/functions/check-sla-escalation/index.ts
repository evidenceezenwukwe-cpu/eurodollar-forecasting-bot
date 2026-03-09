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

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find open/in_progress tickets with no response older than 24h
    const { data: breachedTickets, error } = await supabase
      .from('support_tickets')
      .select('*, profiles!support_tickets_user_id_fkey(email)')
      .in('status', ['open', 'in_progress'])
      .is('last_response_at', null)
      .lt('created_at', twentyFourHoursAgo);

    if (error) throw error;

    if (!breachedTickets || breachedTickets.length === 0) {
      return new Response(JSON.stringify({ escalated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const telegramChannelId = Deno.env.get("TELEGRAM_CHANNEL_ID");

    if (telegramBotToken && telegramChannelId) {
      const ticketLines = breachedTickets.map((t: any) => {
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60));
        return `• \`${t.id.slice(0, 8)}\` - ${t.title} (${age}h ago, ${t.priority})`;
      }).join('\n');

      const message = `
⚠️ *SLA BREACH ALERT*

${breachedTickets.length} ticket(s) have exceeded the 24h response SLA:

${ticketLines}

_Please respond immediately._
      `.trim();

      await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChannelId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });
    }

    return new Response(JSON.stringify({ escalated: breachedTickets.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error("SLA check error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
