import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const MANAGED_ROLES = ["admin", "moderator", "support_agent"] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export function canAssignRole(actorRole: string | null, targetRole: string) {
  if (actorRole !== "admin") {
    return {
      allowed: false,
      status: 403,
      reason: "Only admins can assign privileged roles",
    };
  }

  if (!MANAGED_ROLES.includes(targetRole as ManagedRole)) {
    return {
      allowed: false,
      status: 400,
      reason: "Invalid role",
    };
  }

  return { allowed: true, status: 200, reason: "ok" };
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip");
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
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: actorIsAdmin, error: roleError } = await serviceClient.rpc("has_role", {
      _user_id: authData.user.id,
      _role: "admin",
    });

    if (roleError) throw roleError;

    const body = await req.json().catch(() => ({}));
    const targetEmail = String((body as any).target_email || "").trim().toLowerCase();
    const targetRole = String((body as any).role || "").trim().toLowerCase();

    const validation = canAssignRole(actorIsAdmin ? "admin" : null, targetRole);
    if (!validation.allowed) {
      return new Response(JSON.stringify({ error: validation.reason }), {
        status: validation.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetEmail) {
      return new Response(JSON.stringify({ error: "target_email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("id, email")
      .eq("email", targetEmail)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!targetProfile) {
      return new Response(JSON.stringify({ error: "Target user not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insertError } = await serviceClient.from("user_roles").insert({
      user_id: targetProfile.id,
      role: targetRole,
    });

    if (insertError && insertError.code !== "23505") {
      throw insertError;
    }

    await serviceClient.rpc("log_admin_action", {
      p_action: "admin_role_assigned",
      p_target: `${targetProfile.id}:${targetRole}`,
      p_admin_user_id: authData.user.id,
      p_ip: getClientIp(req),
    });

    return new Response(
      JSON.stringify({
        success: true,
        target_user_id: targetProfile.id,
        role: targetRole,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("admin-manage-role error:", error);
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