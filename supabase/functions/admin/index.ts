import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const PRIVILEGED_ROLES = ["admin", "moderator", "support_agent"] as const;
export type PrivilegedRole = (typeof PRIVILEGED_ROLES)[number];

export const isPrivilegedRole = (role: string | null): role is PrivilegedRole =>
  !!role && PRIVILEGED_ROLES.includes(role as PrivilegedRole);

async function resolvePrivilegedRole(supabase: any, userId: string): Promise<PrivilegedRole | null> {
  for (const role of PRIVILEGED_ROLES) {
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: role,
    });

    if (error) {
      console.error("Role check failed:", error);
      return null;
    }

    if (data) return role;
  }

  return null;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const role = await resolvePrivilegedRole(serviceClient, authData.user.id);

    if (!isPrivilegedRole(role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = (body as any).action || url.searchParams.get("action") || "authorize";

    if (action === "latest_run") {
      const { data: latestRun, error } = await serviceClient
        .from("engine_run_logs")
        .select("id, run_mode, started_at, completed_at, strategies_run, signals_generated, signals_blocked, api_calls, symbols_scanned, details, error")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          authorized: true,
          role,
          latest_run: latestRun,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        authorized: true,
        role,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("admin function error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) {
  serve(handler);
}

export { handler };