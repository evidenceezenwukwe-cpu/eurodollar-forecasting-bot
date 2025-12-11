-- Create predictions table to store AI trading signals
CREATE TABLE public.predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'HOLD')),
  confidence DECIMAL(5, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  entry_price DECIMAL(10, 5) NOT NULL,
  take_profit_1 DECIMAL(10, 5),
  take_profit_2 DECIMAL(10, 5),
  stop_loss DECIMAL(10, 5),
  current_price_at_prediction DECIMAL(10, 5) NOT NULL,
  trend_direction TEXT NOT NULL CHECK (trend_direction IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  trend_strength DECIMAL(5, 2) CHECK (trend_strength >= 0 AND trend_strength <= 100),
  reasoning TEXT,
  technical_indicators JSONB,
  patterns_detected JSONB,
  sentiment_score DECIMAL(5, 2) CHECK (sentiment_score >= -100 AND sentiment_score <= 100),
  outcome TEXT CHECK (outcome IN ('WIN', 'LOSS', 'PENDING', 'EXPIRED')),
  outcome_price DECIMAL(10, 5),
  outcome_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '4 hours')
);

-- Create price_history table for caching forex data
CREATE TABLE public.price_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL DEFAULT 'EUR/USD',
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  open DECIMAL(10, 5) NOT NULL,
  high DECIMAL(10, 5) NOT NULL,
  low DECIMAL(10, 5) NOT NULL,
  close DECIMAL(10, 5) NOT NULL,
  volume DECIMAL(20, 2),
  timeframe TEXT NOT NULL DEFAULT '1h',
  UNIQUE(symbol, timestamp, timeframe)
);

-- Create indexes for better query performance
CREATE INDEX idx_predictions_created_at ON public.predictions(created_at DESC);
CREATE INDEX idx_predictions_outcome ON public.predictions(outcome);
CREATE INDEX idx_price_history_symbol_timestamp ON public.price_history(symbol, timestamp DESC);
CREATE INDEX idx_price_history_timeframe ON public.price_history(timeframe, timestamp DESC);

-- Enable Row Level Security (public read for this demo)
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- Allow public read access to predictions (trading signals are public)
CREATE POLICY "Allow public read access to predictions"
ON public.predictions
FOR SELECT
USING (true);

-- Allow public read access to price history
CREATE POLICY "Allow public read access to price history"
ON public.price_history
FOR SELECT
USING (true);

-- Allow edge functions to insert/update predictions (using service role)
CREATE POLICY "Allow service role to manage predictions"
ON public.predictions
FOR ALL
USING (true)
WITH CHECK (true);

-- Allow edge functions to manage price history
CREATE POLICY "Allow service role to manage price history"
ON public.price_history
FOR ALL
USING (true)
WITH CHECK (true);

-- Enable realtime for predictions table
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;