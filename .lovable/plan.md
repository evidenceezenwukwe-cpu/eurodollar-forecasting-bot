

# Analysis: Stop Losses Still Too Tight

## The Problem

The current SL logic sets the stop at the **wick of a single M15 candle** plus a 5-pip buffer. On M15, candle wicks are often tiny (1-3 pips), so the total SL distance is frequently only **6-8 pips** — not enough room for normal market noise.

```text
Example SELL signal:
  Entry (body high):    1.08500
  Wick (candle high):   1.08520  ← only 2 pips above entry
  + 5 pip buffer:       1.08570  ← total SL = 7 pips
  
  Normal M15 noise can easily be 10-20 pips
```

## Proposed Fix: ATR-Based Minimum Stop Loss

Keep the structural anchor (sweep wick + 5 pip buffer) but enforce a **minimum SL distance** based on the M15 ATR (Average True Range). This ensures stops respect market volatility while staying structurally valid.

**Logic**:
- Calculate M15 ATR(14) from recent candles
- Minimum SL = `1.5 × ATR`
- If the structural SL (wick + 5 pips) is tighter than the ATR minimum, widen it to the ATR minimum
- This typically produces SL distances of **15-30 pips** for major pairs, scaling naturally with volatility

```text
Example after fix:
  Entry:          1.08500
  Structural SL:  1.08570  (7 pips — too tight)
  M15 ATR(14):    0.00120  (12 pips)
  Min SL:         1.5 × 12 = 18 pips
  Final SL:       1.08680  (18 pips — respects volatility)
```

## Changes

| File | Change |
|------|--------|
| `scan-opportunities/index.ts` | Add ATR calculation for M15 candles, enforce minimum SL of 1.5× ATR. Only lines 669-674 affected (the SL buffer block). |

No other files or logic touched.

