-- Admin audit log table
CREATE TABLE IF NOT EXISTS public.admin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON public.admin_action_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin_user_id ON public.admin_action_logs (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_action ON public.admin_action_logs (action);

-- Capture request IP from API headers when available
CREATE OR REPLACE FUNCTION public.get_request_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  headers jsonb;
  ip text;
BEGIN
  headers := COALESCE(current_setting('request.headers', true), '{}')::jsonb;

  ip := NULLIF(split_part(COALESCE(headers ->> 'x-forwarded-for', ''), ',', 1), '');
  IF ip IS NULL THEN
    ip := NULLIF(headers ->> 'cf-connecting-ip', '');
  END IF;

  RETURN ip;
END;
$$;

-- Single audit insert function
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action text,
  p_target text DEFAULT NULL,
  p_admin_user_id uuid DEFAULT auth.uid(),
  p_ip text DEFAULT public.get_request_ip()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_admin_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_action_logs (admin_user_id, action, target, ip)
  VALUES (p_admin_user_id, p_action, p_target, p_ip);
END;
$$;

-- RLS: privileged roles can read logs, only admins can insert directly
DROP POLICY IF EXISTS "Privileged can read admin action logs" ON public.admin_action_logs;
CREATE POLICY "Privileged can read admin action logs"
ON public.admin_action_logs
FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  OR public.has_role(auth.uid(), 'support_agent'::public.app_role)
);

DROP POLICY IF EXISTS "Admins can insert admin action logs" ON public.admin_action_logs;
CREATE POLICY "Admins can insert admin action logs"
ON public.admin_action_logs
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Trigger function: audit plan feature changes
CREATE OR REPLACE FUNCTION public.audit_plan_feature_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_name text;
  target_value text;
BEGIN
  action_name := CASE TG_OP
    WHEN 'INSERT' THEN 'plan_feature_created'
    WHEN 'UPDATE' THEN 'plan_feature_updated'
    WHEN 'DELETE' THEN 'plan_feature_deleted'
    ELSE 'plan_feature_changed'
  END;

  target_value := COALESCE(NEW.plan, OLD.plan) || ':' || COALESCE(NEW.feature, OLD.feature);

  PERFORM public.log_admin_action(action_name, target_value, auth.uid(), public.get_request_ip());

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_plan_features ON public.plan_features;
CREATE TRIGGER trg_audit_plan_features
AFTER INSERT OR UPDATE OR DELETE ON public.plan_features
FOR EACH ROW
EXECUTE FUNCTION public.audit_plan_feature_change();

-- Trigger function: audit whitelist changes
CREATE OR REPLACE FUNCTION public.audit_whitelist_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_name text;
  target_value text;
BEGIN
  action_name := CASE TG_OP
    WHEN 'INSERT' THEN 'whitelist_email_added'
    WHEN 'UPDATE' THEN 'whitelist_email_updated'
    WHEN 'DELETE' THEN 'whitelist_email_removed'
    ELSE 'whitelist_email_changed'
  END;

  target_value := COALESCE(NEW.email, OLD.email);

  PERFORM public.log_admin_action(action_name, target_value, auth.uid(), public.get_request_ip());

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_whitelisted_emails ON public.whitelisted_emails;
CREATE TRIGGER trg_audit_whitelisted_emails
AFTER INSERT OR UPDATE OR DELETE ON public.whitelisted_emails
FOR EACH ROW
EXECUTE FUNCTION public.audit_whitelist_change();

-- Trigger function: audit privileged role assignments
CREATE OR REPLACE FUNCTION public.audit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_name text;
  target_value text;
  role_changed_to_privileged boolean;
BEGIN
  role_changed_to_privileged :=
    (TG_OP = 'INSERT' AND NEW.role IN ('admin', 'moderator', 'support_agent'))
    OR (TG_OP = 'UPDATE' AND NEW.role IN ('admin', 'moderator', 'support_agent') AND NEW.role IS DISTINCT FROM OLD.role)
    OR (TG_OP = 'DELETE' AND OLD.role IN ('admin', 'moderator', 'support_agent'));

  IF NOT role_changed_to_privileged THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  action_name := CASE TG_OP
    WHEN 'INSERT' THEN 'role_assigned'
    WHEN 'UPDATE' THEN 'role_updated'
    WHEN 'DELETE' THEN 'role_removed'
    ELSE 'role_changed'
  END;

  target_value := COALESCE(NEW.user_id, OLD.user_id)::text || ':' || COALESCE(NEW.role::text, OLD.role::text);

  PERFORM public.log_admin_action(action_name, target_value, auth.uid(), public.get_request_ip());

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.audit_user_role_change();