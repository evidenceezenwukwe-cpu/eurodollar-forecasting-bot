-- Create prediction_learnings table to store lessons from evaluated predictions
CREATE TABLE public.prediction_learnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prediction_id UUID REFERENCES public.predictions(id) ON DELETE CASCADE,
  pattern_context JSONB,
  market_conditions JSONB,
  lesson_extracted TEXT NOT NULL,
  failure_reason TEXT,
  success_factors TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.prediction_learnings ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Allow public read access to learnings"
ON public.prediction_learnings
FOR SELECT
USING (true);

-- Service role can manage
CREATE POLICY "Allow service role to manage learnings"
ON public.prediction_learnings
FOR ALL
USING (true)
WITH CHECK (true);