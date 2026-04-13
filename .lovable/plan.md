

## Fix: Duplicate Identical Signals

### Root Cause

Two bugs combine to allow the same signal to be generated repeatedly:

1. **4-hour dedup window matches signal lifetime** — The scanner checks for duplicates within a 4-hour window (`gte created_at - 4h`). But the scanner runs every 4 hours, so previous signals fall exactly at the boundary and slip through. The three USD/JPY signals were created at 10:00, 14:00, 18:00 — each exactly 4 hours apart.

2. **Deterministic CRT output** — The same H4 candle structure keeps producing the identical entry price (159.6235), SL, TP, and confidence. The dedup check technically works for price proximity (0 pips < 15 = should skip), but the timing window lets them through.

### Fix

**File: `supabase/functions/scan-opportunities/index.ts`**

1. **Extend dedup window from 4 hours to 8 hours** — This ensures the previous signal is always within range, even with 4-hour scan intervals.

2. **Add exact-match check with 24-hour window** — Before the proximity check, query for any signal in the last 24 hours with the same symbol, direction, AND identical entry price. If found, skip immediately. This catches cases where the same CRT structure persists across an entire session.

3. **Fix the variable naming** — Rename `currentPrice` on line 1120 to `analysisEntryPrice` to make it clear this is NOT the market's current price. The current code is confusing and masks bugs.

### Expected Result

| Before | After |
|--------|-------|
| 3 identical USD/JPY signals in one day | 1 signal, subsequent identical setups blocked |
| Telegram spam with duplicate alerts | Single clean alert per unique setup |

### Files Modified
| File | Change |
|------|--------|
| `supabase/functions/scan-opportunities/index.ts` | Extend dedup window to 8h, add 24h exact-match guard, rename misleading variable |

