

## Root Cause: Duplicate Signal Bug

**The problem is in `scan-opportunities/index.ts` lines 1039-1048.** The duplicate check only compares against `recentOpps[0]` (a single, randomly-ordered record) instead of checking ALL recent opportunities.

### Evidence

AUD/USD created 5 identical BUY signals (entry 0.69931) between 06:50-07:30 on March 9. There was also an earlier signal at 06:15 with entry 0.69654. Since the query has **no `.order()` clause**, `recentOpps[0]` randomly picks the older 06:15 record, calculates a 27.7 pip difference (> 15 threshold), and allows the duplicate through.

Similarly, USD/JPY created 2 identical SELL signals (entry 157.68646) 5 minutes apart on March 10.

### The Fix

**File: `supabase/functions/scan-opportunities/index.ts` (lines 1039-1048)**

Change from checking only `recentOpps[0]` to checking ALL recent opportunities using `.some()` — matching the pattern already correctly used in `strategy-engine/index.ts` (line 677):

```typescript
// BEFORE (buggy):
if (recentOpps && recentOpps.length > 0) {
  const mostRecent = recentOpps[0];  // ← random order!
  const priceDiff = Math.abs(currentPrice - mostRecent.entry_price);
  const pipValue = getPipValue(symbol);
  const pipsDiff = priceDiff / pipValue;
  if (pipsDiff < 15) { ... }
}

// AFTER (fixed):
if (recentOpps && recentOpps.length > 0) {
  const pipValue = getPipValue(symbol);
  const tooClose = recentOpps.some((opp: any) => {
    const pipsDiff = Math.abs(currentPrice - opp.entry_price) / pipValue;
    return pipsDiff < 15;
  });
  if (tooClose) {
    console.log(`[${symbol}] Similar opportunity exists within 15 pips`);
    return { success: true, message: `Similar ${analysis.signal} opportunity exists for ${symbol}` };
  }
}
```

This is a one-file fix. No database or UI changes needed.

