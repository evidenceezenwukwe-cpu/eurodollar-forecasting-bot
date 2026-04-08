

## Clean Slate + System Improvements

### Step 1: Clear All AI Learnings
- Delete all 162 rows from `prediction_learnings` table using the insert/update tool
- This gives the AI a fresh start without legacy bias

### Step 2: Require Inducement Confirmation
**File:** `supabase/functions/scan-opportunities/index.ts`

The data is clear: signals with M15 Inducement have a 78.4% win rate vs 61.4% without. Change the entry confirmation logic to **require** at least one Inducement tap (not just BOS alone) before generating a signal. Signals that only have BOS without Inducement should be skipped or given significantly lower confidence that falls below the threshold.

### Step 3: Disable Underperforming Pair/Direction Combos
**File:** `supabase/functions/scan-opportunities/index.ts`

Add a blocklist for pair+direction combos with sub-50% win rates:
- XAU/USD BUY (46.2%)
- EUR/GBP SELL (40.0%)
- USD/CHF BUY (37.5%)
- AUD/JPY BUY (40.0%)
- EUR/JPY SELL (40.0%)

These combos should be skipped during scanning. This can be a simple config map checked before signal generation.

### Step 4: Tighten Entry Price Distance
**File:** `supabase/functions/scan-opportunities/index.ts`

Reduce the maximum allowed distance between current price and entry price. The 25.8% expiration rate suggests entries are often set at levels the market doesn't reach within the signal's lifetime. Tightening this (e.g., max 30 pips for majors, 50 for JPY pairs, 200 for XAU) will reduce expired signals.

### Step 5: Recalibrate Confidence Scoring
**File:** `supabase/functions/scan-opportunities/index.ts`

Update the confidence model to weight factors that actually correlate with wins:
- **Inducement present:** +10 (up from current bonus)
- **Strong pair/direction combo** (EUR/USD BUY, USD/JPY SELL, GBP/USD SELL): +5
- **Weak pair/direction combo:** -10 (should push below threshold)
- **Entry distance:** penalize signals where entry is far from current price

### Step 6: Redeploy Scanner
Deploy the updated `scan-opportunities` edge function with all changes.

### Summary of Expected Impact

| Metric | Current | Expected |
|--------|---------|----------|
| Win Rate | 63.3% | ~72-75% |
| Expiration Rate | 25.8% | ~12-15% |
| Signal Volume | ~15/day | ~8-10/day (higher quality) |
| Inducement Signals | 11% of total | 100% of total |

### Files Modified
| File | Change |
|------|--------|
| `prediction_learnings` table | Clear all 162 rows |
| `scan-opportunities/index.ts` | Require inducement, add pair blocklist, tighten entries, recalibrate confidence |

