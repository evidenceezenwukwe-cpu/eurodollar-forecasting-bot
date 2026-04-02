

## Fix: Evaluation Uses Future Price Data — Producing False Results

### Root Cause Identified

The `price_history` table contains **future price data** (currently has data up to 19:45 UTC today while it's only ~10:00 UTC). When the evaluator runs, it queries all price candles from `created_at` onward **with no upper time bound**, so it evaluates trades against prices that haven't happened yet.

**Proof from the database:**
- Trade `a92e145e` (EUR/JPY BUY): evaluated at 07:40 UTC, but `triggered_at` is 17:15 UTC — 10 hours in the future. Marked as WIN using price data that doesn't exist yet.
- Trade `a6855f29` (XAU/USD SELL): evaluated at 05:20 UTC, `triggered_at` is 10:15 UTC — 5 hours later. Marked as WIN.
- Trade `a08f3349` (AUD/USD SELL): evaluated at 05:20, `triggered_at` is 11:45 — 6.5 hours in the future.

Every single trade in the query has `triggered_at > evaluated_at`. This means outcomes are being decided using candles that haven't formed yet.

### The Fix

**File: `supabase/functions/evaluate-opportunities/index.ts`**

Two changes to the price history query (lines 318-324):

1. **Cap price data at current time** — add `.lte('timestamp', new Date().toISOString())` so the evaluator only sees candles that have already closed.

2. **Cap entry detection at expiry** — in `evaluateOutcome()`, the entry price must be reached **before** `expires_at`. If the entry triggers on a candle after expiry, it should not count. Add the `expires_at` as a parameter and skip entry detection on candles past that time.

3. **Additional safeguard in `evaluateOutcome()`** — accept `expiresAt` as a parameter. During the entry-check phase (step 1), if `point.timestamp > expiresAt`, stop looking for entry and treat as EXPIRED. After entry triggers, SL/TP checks continue on candles up to current time (since the trade is live after triggering).

### Summary of Changes

| What | Where | Change |
|------|-------|--------|
| Add time cap to price query | Line 318-324 | Add `.lte('timestamp', now)` |
| Pass `expiresAt` to evaluator | Line 335 | Add parameter |
| Stop entry search at expiry | `evaluateOutcome()` | If candle timestamp > expiresAt during entry phase, return EXPIRED |

### No database or UI changes needed.

