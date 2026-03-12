

## Two Issues Found

### Issue 1: Confidence Always 85%

**Root cause**: `calculateCRTConfidence()` in `scan-opportunities/index.ts` (line 648-681).

The scoring adds up: base 40 + HTF rejection (10-15) + H4 sweep (20) + M15 BOS (20) = **90-95 minimum**, then caps at `Math.min(85, confidence)`. Since H4 sweep and M15 BOS are prerequisites to reach this function, every signal trivially scores the maximum.

The dynamic 50-58 model was implemented in `strategy-engine/index.ts` (user strategies) but **never applied to the main CRT scanner** which generates the majority of signals.

**Fix**: Rewrite `calculateCRTConfidence()` to use the same conservative 50-58 model:
- Base: 50
- HTF weekly rejection: +3 (daily: +1)
- H4 sweep confirmed: +2 (always present, included in base expectation)
- M15 inducement found: +2
- Near key S/R level: +2
- Cap at 58

This aligns the CRT scanner with the strategy engine and the documented confidence model.

### Issue 2: Daily Report / Evaluation Doesn't Check If Entry Was Reached

**Root cause**: `evaluateOutcome()` in `evaluate-opportunities/index.ts` (lines 47-94).

The function iterates through price candles and checks if SL or TP was ever hit, but it **never verifies the entry price was actually reached first**. This means:

- A BUY signal at 1.0850 with TP at 1.0900 — if price went from 1.0870 straight to 1.0900 without ever dipping to 1.0850, the trade was **never triggered** but gets marked as WIN.
- A SELL signal at 157.500 — if price never rose to 157.500, SL/TP checks are meaningless.

**Fix**: Add an entry-reached check before SL/TP evaluation:

```text
For each price candle (chronological):
  1. If trade NOT yet triggered:
     - BUY: check if candle.low <= entry_price (price dipped to entry)
     - SELL: check if candle.high >= entry_price (price rose to entry)
     - If triggered, record triggered_at timestamp, continue
  2. If trade IS triggered:
     - Check SL/TP as before
  3. If expired without ever triggering:
     - outcome = EXPIRED (not WIN or LOSS)
```

The daily report itself (`send-daily-report/index.ts`) is fine — it just reads the outcomes already stored. The fix is entirely in the evaluation logic.

**Side effect on daily report pips calculation**: The daily report (line 66-72) assumes WIN pips = |TP1 - entry| and LOSS pips = |SL - entry|. This is correct for properly evaluated trades. No change needed there once evaluation is fixed.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/scan-opportunities/index.ts` | Rewrite `calculateCRTConfidence()` to use 50-58 range |
| `supabase/functions/evaluate-opportunities/index.ts` | Add entry-price-reached check before SL/TP evaluation in `evaluateOutcome()`, update opportunity `triggered_at` |

### No database changes needed.

