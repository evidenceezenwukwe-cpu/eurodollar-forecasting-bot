

## Fix Three Strategy Engine Bugs

### Bug 1: Direction Detection for FVG/OB/Inducement Entries

**Problem** (line 311 in `strategy-engine/index.ts`, line 311 in `evaluate-user-strategy/index.ts`):
```typescript
const direction = rules.entry.condition.includes('bullish') ? 'bullish' : 'bearish';
```
Conditions like `fvg_entry`, `order_block_entry`, `inducement_tap`, and `market_order` don't contain "bullish" in their name, so they always default to `bearish` — producing wrong SELL signals.

**Fix**: Derive direction from the evaluation result. The primitive functions (`checkFVGEntry`, `checkOrderBlockEntry`, `checkRangeSweep`) already detect direction internally but don't expose it. Update them to return `details.direction`, then use that as the source of truth. Fallback chain: `entryResult.details?.direction` → `triggerResult.details?.direction` → price-action heuristic (close > open of last candle = bullish).

Apply this fix in both `strategy-engine/index.ts` (line 311) and `evaluate-user-strategy/index.ts` (equivalent line ~350).

### Bug 2: HTF Bias Not Evaluated

**Problem**: The DSL supports `rules.htf_bias` (e.g., `{ timeframe: "1d", condition: "bullish_trend" }`) but `runUserStrategy` never reads or evaluates it. Signals fire without confirming higher-timeframe alignment.

**Fix**: After trigger passes but before entry evaluation, fetch HTF candles and check bias. Add new primitives:
- `bullish_trend`: EMA-based check (last close > EMA of last 20 candles)
- `bearish_trend`: last close < EMA of last 20 candles
- `sweep_high` / `sweep_low`: reuse existing primitives on HTF data

If HTF bias check fails, skip the signal. This adds ~1 DB query per strategy-symbol pair (only when trigger fires).

### Bug 3: Static Confidence (hardcoded 70)

**Problem** (line 320): `confidence: 70` for every user strategy signal, regardless of setup quality. This makes the conflict resolution algorithm ineffective since all user signals tie.

**Fix**: Build a dynamic confidence scorer that starts at a base of 50 and adds bonuses:

| Factor | Bonus |
|--------|-------|
| HTF bias aligned | +10 |
| Trigger fired (sweep/BOS) | +8 (base, always present) |
| Entry confirmed (FVG/OB) | +5 |
| Multiple confirmations (trigger + entry different types) | +4 |
| Session overlap (London/NY) | +3 |
| **Cap** | **58** (per existing confidence model) |

This respects the existing confidence model (50-58 range, hard cap at 58).

### Files Modified

1. **`supabase/functions/strategy-engine/index.ts`**:
   - Update `checkFVGEntry`, `checkOrderBlockEntry`, `checkInducement`/`checkInducementTap` to return `details.direction`
   - Add `inferDirection()` helper using result details + price action fallback
   - Add `evaluateHTFBias()` function with EMA-based trend detection
   - Add `calculateDynamicConfidence()` function (50-58 range)
   - Update `runUserStrategy` to call HTF bias, use inferred direction, and compute dynamic confidence

2. **`supabase/functions/evaluate-user-strategy/index.ts`**: Mirror the same three fixes (direction, HTF bias, dynamic confidence) for consistency since this is the standalone version of the same logic.

### No database or UI changes needed.

