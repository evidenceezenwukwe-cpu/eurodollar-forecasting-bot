
-- Create user_strategies table
CREATE TABLE public.user_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rules_json JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  sandbox_mode BOOLEAN NOT NULL DEFAULT true,
  sandbox_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '7 days'),
  max_strategies_limit INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_strategies ENABLE ROW LEVEL SECURITY;

-- Users can manage their own strategies
CREATE POLICY "Users can read own strategies"
  ON public.user_strategies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strategies"
  ON public.user_strategies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategies"
  ON public.user_strategies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own strategies"
  ON public.user_strategies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can manage all
CREATE POLICY "Admins can manage all strategies"
  ON public.user_strategies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Updated_at trigger
CREATE TRIGGER update_user_strategies_updated_at
  BEFORE UPDATE ON public.user_strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_strategies;
