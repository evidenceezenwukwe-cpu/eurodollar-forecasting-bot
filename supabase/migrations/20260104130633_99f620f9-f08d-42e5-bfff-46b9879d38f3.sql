-- Delete learnings linked to trading opportunities (stale weekend data)
DELETE FROM prediction_learnings WHERE opportunity_id IS NOT NULL;

-- Delete all stale trading opportunities (34 duplicate weekend records)
DELETE FROM trading_opportunities;

-- Delete old predictions before model update (Dec 26, 2025)
DELETE FROM predictions WHERE created_at < '2025-12-26';

-- Delete orphaned learnings from deleted predictions
DELETE FROM prediction_learnings 
WHERE prediction_id NOT IN (SELECT id FROM predictions);