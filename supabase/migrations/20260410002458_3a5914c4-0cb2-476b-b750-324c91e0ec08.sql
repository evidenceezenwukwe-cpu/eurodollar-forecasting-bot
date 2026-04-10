
-- 1. Drop overly permissive "service role" policies on 9 tables (service_role bypasses RLS automatically)
DROP POLICY IF EXISTS "Allow service role to manage predictions" ON predictions;
DROP POLICY IF EXISTS "Allow service role to manage learnings" ON prediction_learnings;
DROP POLICY IF EXISTS "Allow service role to manage pattern statistics" ON pattern_statistics;
DROP POLICY IF EXISTS "Allow service role to manage pattern metrics" ON pattern_metrics;
DROP POLICY IF EXISTS "Allow service role to manage price history" ON price_history;
DROP POLICY IF EXISTS "Allow service role to manage historical data" ON historical_price_data;
DROP POLICY IF EXISTS "Allow service role to manage opportunities" ON trading_opportunities;
DROP POLICY IF EXISTS "Service role can manage blocked signals" ON blocked_signals;
DROP POLICY IF EXISTS "Service role manages engine logs" ON engine_run_logs;

-- 2. Fix strategy_profiles: change write policies from public to authenticated role
DROP POLICY IF EXISTS "Users can insert own profiles" ON strategy_profiles;
DROP POLICY IF EXISTS "Users can update own profiles" ON strategy_profiles;
DROP POLICY IF EXISTS "Users can delete own profiles" ON strategy_profiles;

CREATE POLICY "Users can insert own profiles" ON strategy_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profiles" ON strategy_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own profiles" ON strategy_profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 3. Fix whitelisted_emails: remove public read, keep admin-only
DROP POLICY IF EXISTS "Service role can read whitelist" ON whitelisted_emails;

-- 4. Fix prediction_learnings: restrict read to authenticated users
DROP POLICY IF EXISTS "Allow public read access to learnings" ON prediction_learnings;

CREATE POLICY "Authenticated can read learnings" ON prediction_learnings
  FOR SELECT TO authenticated
  USING (true);
