

# Revert 15min Cache Freshness to 110 Seconds

With 12 API keys providing ~9,600 daily credits, the original 110s freshness is sustainable. Reverting ensures faster M15 Break of Structure detection for the CRT strategy.

## Change

**File**: `supabase/functions/fetch-forex-data/index.ts`

Change `"15min": 240_000` back to `"15min": 110_000`.

Single line change, no other files affected.

