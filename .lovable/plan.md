

## Fix: Zero Signals Generated Since April 3

### Root Cause

The scanner runs every 5 minutes and works correctly, but the combination of three strict filters added on April 3 has been **too aggressive** — zero signals have passed all checks in 7 days:

1. **Mandatory Inducement** — requires M15 inducement tap (most setups don't have one)
2. **Pair Blocklist** — blocks 5 pair/direction combos entirely
3. **Tight Entry Distance** — 30 pips for majors, 50 for JPY, 200 for XAU

Together these filters eliminate every setup the market produces. Telegram notifications are fine — they just never get triggered because no signals are created.

### Fix Strategy

Relax the filters to be selective but not paralyzing:

**File: `supabase/functions/scan-opportunities/index.ts`**

1. **Make Inducement preferred, not mandatory** — Instead of skipping signals without inducement, apply a confidence penalty (-8). Signals with inducement still get the +10 bonus. This means inducement signals score ~18 points higher, but non-inducement setups can still fire if everything else aligns.

2. **Raise the minimum confidence threshold to 58** — Currently there's no minimum threshold (base is 50). Adding a 58 threshold means only non-inducement signals with multiple other confirmations (strong pair, near S/R, tight entry) can pass. This replaces the hard inducement gate with a quality gate.

3. **Widen entry distance limits** — Increase from 30/50/200 to 50/80/300 pips. The current limits are too tight for normal market conditions.

4. **Keep the pair blocklist** — This is data-driven and reasonable. No change needed.

5. **Add scan logging** — Log which filter step rejected each pair so we can diagnose future droughts without guessing.

### Telegram Verification

After signals start generating again, Telegram notifications will automatically resume (the code at line 1221-1259 is correct). No changes needed to `send-telegram-notification`.

### Expected Impact

| Metric | Current (7 days) | Expected |
|--------|-------------------|----------|
| Signals Generated | 0 | ~5-10/day |
| Inducement Signals | 0 | ~30-40% of total (get higher confidence) |
| Telegram Notifications | 0 | Same as signals generated |
| Win Rate | N/A | ~68-72% (inducement signals still favored) |

### Files Modified
| File | Change |
|------|--------|
| `supabase/functions/scan-opportunities/index.ts` | Remove hard inducement gate, add confidence threshold of 58, widen entry distance, add filter logging |

