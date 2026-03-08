
-- Session preferences table
CREATE TABLE public.user_session_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  allow_london boolean NOT NULL DEFAULT true,
  allow_newyork boolean NOT NULL DEFAULT true,
  allow_asia boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_session_prefs_user ON public.user_session_preferences (user_id);

ALTER TABLE public.user_session_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session preferences"
  ON public.user_session_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session preferences"
  ON public.user_session_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own session preferences"
  ON public.user_session_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Add session_filters feature to funded and lifetime plans
INSERT INTO public.plan_features (plan, feature, enabled) VALUES
  ('funded', 'session_filters', true),
  ('lifetime', 'session_filters', true)
ON CONFLICT DO NOTHING;
