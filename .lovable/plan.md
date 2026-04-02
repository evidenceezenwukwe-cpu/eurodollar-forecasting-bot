

## Remove "EUR/USD Only" Narrative

Updating branding text that implies the app is EUR/USD-exclusive. Price displays showing "EUR/USD" as the active symbol stay untouched — those are dynamic/contextual.

### Changes

**1. `src/components/trading/Header.tsx` (line 18)**
- `"EUR/USD Prediction"` → `"Forex Decision Engine"`

**2. `src/pages/Landing.tsx`**
- Line 146: `"EUR/USD Decision Engine"` → `"Forex Decision Engine"`
- Line 181: `"EUR/USD Only • Focused Precision"` → `"Multi-Pair • Focused Precision"`
- Line 187: `"EUR/USD Decision Engine"` → `"Forex Decision Engine"`
- Lines 227-228: Replace the stat block showing `"EUR/USD"` / `"Focus Pair"` with `"12+"` / `"Currency Pairs"`

**3. `src/components/admin/DailyBiasPanel.tsx` (line 184)**
- `"EUR/USD for {date}"` → `"Forex pairs for {date}"`
- Lines 234, 281: Update placeholder text from `"EUR/USD Daily Bias"` / `"EUR/USD Recap"` to generic `"Daily Bias"` / `"Recap"`

**4. `src/components/admin/WeeklyPostMortem.tsx` (line 156)**
- `"EUR/USD from ..."` → `"Price action from ..."`

**5. Backend prompts** — `generate-prediction/index.ts` and `generate-daily-bias/index.ts`: change any prompt text like `"specializing in EUR/USD"` to `"specializing in forex"`. Default symbol fallbacks (`symbol || 'EUR/USD'`) stay as-is since they're just sensible defaults, not branding.

### What stays unchanged
- `PriceDisplay.tsx` default prop `symbol = 'EUR/USD'` — this is the active pair display
- All edge function fallback defaults (`symbol || 'EUR/USD'`)
- `CandlestickChart.tsx` label — already shows the selected pair dynamically
- `useForexData.ts` default parameter

