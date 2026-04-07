

## Two Fixes: Update API Keys + Fix Rotation + Dashboard Branding

### 1. Update TWELVE_DATA_API_KEYS secret with all 27 keys

The current secret only has 12 keys. We need to update it with all 27 keys as a single comma-separated string. This will be done using the `add_secret` tool to replace the existing value.

**New value** (all 27 keys, comma-separated):
```
4483111f99654c3a86aa6143afaa3290,404c791d90294665959d23db84d233ab,...(all 27)
```

This increases daily capacity from ~9,600 to ~21,600 API credits.

### 2. Fix key rotation to try ALL keys, not just 3

**File**: `supabase/functions/fetch-forex-data/index.ts`

Current code caps retries at 3 keys:
```
const maxAttempts = Math.min(keys.length, 3);
```

Change to try all available keys before giving up:
```
const maxAttempts = keys.length;
```

Also update the rotation logic so that on quota errors, it sequentially tries the next key index rather than only offsetting by +1 from a time-slot base (which clusters attempts on adjacent keys).

### 3. Fix `evaluate-predictions` to use cached price data

The `evaluate-predictions` function makes its own direct Twelve Data API call (using a single key) instead of reading from `price_history`. This wastes credits unnecessarily.

**File**: `supabase/functions/evaluate-predictions/index.ts`

Change `fetchCurrentPrice()` to query the `price_history` table for the latest cached price instead of calling the Twelve Data API directly. Fall back to API only if no cached data exists.

### 4. Dashboard header branding fix

**File**: `src/components/dashboard/DashboardHeader.tsx`, line 70

Change `"EUR/USD Decision Engine"` to `"Forex Decision Engine"`.

### Summary

| Change | File |
|--------|------|
| Update secret with 27 keys | TWELVE_DATA_API_KEYS secret |
| Try all keys instead of 3 | `fetch-forex-data/index.ts` |
| Use cached prices in evaluator | `evaluate-predictions/index.ts` |
| Fix dashboard branding | `DashboardHeader.tsx` line 70 |

