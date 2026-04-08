

## Fix: No Prices Displayed + No Signals for Days

### Root Causes Identified

**Problem 1 — No prices on dashboard**: The `MultiPriceDisplay` component queries `price_history` for `timeframe = '1h'`, but there is **zero `1h` data** in the database. The background scanner only caches `1d`, `4h`, and `15min` data. When the user's browser calls `useForexData('1h')`, all API keys are exhausted so it can't fetch live data either, and the cache fallback finds nothing for `1h`.

**Problem 2 — No signals since April 3**: The scanner requires daily (`1d`) candles for CRT analysis. Logs show every pair has `Daily=0` candles cached because `ensureTimeframeData(1d)` fails — all 27 API keys are exhausted. Without daily data, the scanner skips every pair ("Insufficient data for CRT analysis").

**Problem 3 — Why all 27 keys are exhausted**: Each scan cycle calls `fetch-forex-data` for 3 timeframes × 12 pairs = 36 API calls, each requesting `outputsize=200` (200 credits per call). At ~7,200 credits per scan and scans running frequently, all 21,600 daily credits are burned quickly. The `1d` timeframe doesn't need 200 candles — 60 is plenty.

### Plan

**1. Fix `MultiPriceDisplay` to use available data** (`src/components/trading/MultiPriceDisplay.tsx`)
- Change the query from `timeframe = '1h'` to `timeframe = '15min'` (which is always cached by the scanner)
- This immediately fixes the empty price ticker

**2. Fix `useForexData` cache fallback to try multiple timeframes** (`src/hooks/useForexData.ts`)
- In the catch block's cache fallback, if no data is found for the requested timeframe (e.g. `1h`), also try `4h` and `15min` before giving up
- This ensures the chart always shows something even when `1h` isn't cached

**3. Reduce daily candle outputsize to conserve credits** (`supabase/functions/scan-opportunities/index.ts`)
- When calling `ensureTimeframeData` for `1d`, pass a smaller outputsize (60 instead of 200) — daily candles don't need 200 bars
- This saves ~140 credits per pair per scan for the daily timeframe alone

**4. Add `1h` to the scanner's background fetch cycle** (`supabase/functions/scan-opportunities/index.ts`)
- After ensuring HTF/trigger/entry data, also ensure `1h` data is cached so the dashboard has it available
- Use a small outputsize (100) for `1h` to limit credit usage

**5. Lower default outputsize for `1d` in fetch-forex-data** (`supabase/functions/fetch-forex-data/index.ts`)
- Change `defaultOutputsizeFor('1d')` from 200 to 60 — 200 daily candles is excessive and wastes credits

### Files to Modify

| File | Change |
|------|--------|
| `src/components/trading/MultiPriceDisplay.tsx` | Query `15min` instead of `1h` |
| `src/hooks/useForexData.ts` | Fallback cache reads try `4h`, `15min` if requested TF empty |
| `supabase/functions/scan-opportunities/index.ts` | Add `1h` caching; pass smaller outputsize for `1d` |
| `supabase/functions/fetch-forex-data/index.ts` | Reduce `1d` default outputsize from 200 to 60 |

