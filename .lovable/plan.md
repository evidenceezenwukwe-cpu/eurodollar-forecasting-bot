

# Replace Mean-Reversion Logic with CRT + MSNR Strategy

## Overview

Replace the entire signal detection engine inside `supabase/functions/scan-opportunities/index.ts` with a multi-timeframe CRT (Candle Range Theory) + MSNR (Model 1: BOS + Inducement) strategy. No changes to the database schema, Twelve Data integration, Telegram notification function, or UI.

## Current State

The scanner currently:
- Reads only **1h** candles from `price_history`
- Uses RSI, Bollinger Bands, MACD, Stochastic, EMA crossovers with weighted scoring
- Applies ATR-based SL/TP with 1:2.2 R:R
- Pattern statistics from DB drive confidence scores

## Data Availability Challenge

The `price_history` table currently only has fresh **1h** data. The new strategy needs **Daily, H4, and M15** candles. Solution: scan-opportunities will invoke the existing `fetch-forex-data` edge function for each required timeframe before reading from cache. This uses the existing API pipeline without modifying it. Weekly candles will be aggregated from daily data inside the scanner.

## New Strategy Logic (3-Step Sequential)

### Step A: Higher Timeframe Bias (Weekly/Daily)

```text
1. Read Daily candles (last 30+) from price_history
2. Aggregate last 5-10 daily candles into Weekly candles
3. Identify "Strong High/Low" rejection:
   - Candle sweeps previous candle's high AND closes below it = bearish rejection
   - Candle sweeps previous candle's low AND closes above it = bullish rejection
4. Check rejection against key S/R levels:
   - Rejection at Weekly/Daily resistance zone = BEARISH bias
   - Rejection at Weekly/Daily support zone = BULLISH bias
5. If no clear rejection on Weekly or Daily = NO BIAS = skip symbol
```

### Step B: H4 Candle Range Theory (CRT Sweep)

```text
1. Read H4 candles from price_history
2. Define the "Previous H4 Range" (high and low of prior closed H4 candle)
3. For BEARISH bias: Wait for current price to sweep ABOVE previous H4 high
4. For BULLISH bias: Wait for current price to sweep BELOW previous H4 low
5. The H4 range defines the TP target:
   - SELL TP = previous H4 low
   - BUY TP = previous H4 high
6. If no sweep has occurred = NO SETUP = skip symbol
```

### Step C: M15 Execution (MSNR Model 1)

```text
1. Read M15 candles from price_history (last 20-30 candles)
2. After H4 sweep confirmed, analyze M15 structure:

   For SELL setups (bearish bias + H4 high swept):
   a. Identify HTF Close Key Level (nearest resistance from Daily S/R)
   b. Detect BOS: Find most recent M15 swing low, check if broken downward
   c. Detect Inducement: Minor internal peak between sweep candle and BOS
   d. Entry = the "Strong High" of the M15 sweep candle
   e. SL = above the wick of the M15 sweep candle
   f. TP = H4 range low (opposite side of H4 candle range)

   For BUY setups (bullish bias + H4 low swept):
   a. Identify HTF Close Key Level (nearest support from Daily S/R)
   b. Detect BOS: Find most recent M15 swing high, check if broken upward
   c. Detect Inducement: Minor internal trough between sweep candle and BOS
   d. Entry = the "Strong Low" of the M15 sweep candle
   e. SL = below the wick of the M15 sweep candle
   f. TP = H4 range high
```

## Technical Implementation

### File: `supabase/functions/scan-opportunities/index.ts`

#### What Gets Removed (~650 lines)

- All RSI/MACD/Bollinger/Stochastic/EMA pattern detection functions (lines 106-327)
- `BASE_PATTERN_WEIGHTS` and all tier/weight logic (lines 329-418)
- `analyzeOpportunity()` function (lines 430-761)
- `calculateLevels()` ATR-based function (lines 763-816)
- `getTier1Threshold()` and `getDynamicPatternWeight()` (lines 355-418)
- `detectPatterns()` function (lines 255-304)

#### What Gets Kept

- CORS headers, pip values, market-open check, Supabase client setup
- `getActiveCurrencyPairs()` - needed to know which symbols to scan
- Duplicate/cooldown/reversal detection logic (lines 884-951)
- Telegram notification call (lines 996-1023)
- Main `serve()` handler and multi-symbol loop (lines 1032-1127)
- `isForexMarketOpen()` function

#### New Functions Added

1. **`ensureTimeframeData(supabase, symbol, timeframe)`**
   - Invokes `fetch-forex-data` for the symbol at the given timeframe
   - Ensures fresh cache before reading from `price_history`
   - Called for "1d", "4h", and "15min" per symbol

2. **`aggregateWeeklyCandles(dailyCandles)`**
   - Groups daily candles by ISO week
   - Returns synthetic weekly OHLC candles

3. **`detectHTFBias(weeklyCandles, dailyCandles)`**
   - Scans last 3-5 daily/weekly candles for sweep + rejection patterns
   - Identifies "Strong High" (swept previous high, closed with rejection wick)
   - Returns `{ bias: 'BULLISH' | 'BEARISH' | null, rejectionLevel, keyLevel }`

4. **`detectH4Sweep(h4Candles, bias)`**
   - Defines previous H4 candle range (high/low)
   - Checks if current price has swept beyond the range in bias direction
   - Returns `{ swept: boolean, h4RangeHigh, h4RangeLow, sweepCandle }`

5. **`detectM15Entry(m15Candles, bias, h4Sweep, dailySR)`**
   - Finds M15 swing points using pivot logic (2-bar lookback)
   - Detects BOS (break of structure) on M15
   - Identifies inducement (engineered liquidity) between sweep and BOS
   - Returns `{ valid: boolean, entryPrice, stopLoss, sweepCandle }`

6. **`analyzeCRT(supabase, symbol)`** - Main orchestrator
   - Calls `ensureTimeframeData` for 1d, 4h, 15min
   - Reads cached candles from `price_history`
   - Runs Steps A -> B -> C sequentially (early exit if any step fails)
   - Returns full signal with entry/SL/TP or null

#### Updated `scanSymbol()` Flow

```text
scanSymbol(supabase, symbol)
  |
  +-- ensureTimeframeData(1d)  -- invoke fetch-forex-data
  +-- ensureTimeframeData(4h)  -- invoke fetch-forex-data
  +-- ensureTimeframeData(15min) -- invoke fetch-forex-data
  |
  +-- Read cached candles from price_history (1d, 4h, 15min)
  +-- aggregateWeeklyCandles(dailyCandles)
  |
  +-- Step A: detectHTFBias(weekly, daily) --> bias or null
  +-- Step B: detectH4Sweep(h4, bias) --> sweep or null
  +-- Step C: detectM15Entry(m15, bias, sweep, dailySR) --> entry or null
  |
  +-- If all 3 steps pass:
  |     - Entry = M15 sweep candle strong high/low
  |     - SL = above/below M15 sweep candle wick
  |     - TP1 = opposite side of H4 range
  |     - TP2 = null (single TP target in CRT)
  |     - Confidence = based on rejection clarity + BOS strength
  |     - Insert to trading_opportunities
  |     - Send Telegram notification
  |
  +-- Existing duplicate/cooldown checks remain
```

#### Updated Telegram Signal Content

The `reasoning` field sent to Telegram will be formatted as:

```text
SELL opportunity detected on EUR/USD with 75% confidence.

Bias: BEARISH (Daily resistance rejection at 1.08750)
Setup: H4 Candle Range Sweep Confirmed (H4 High 1.08820 swept)
Entry Model: MSNR Model 1 (BOS + Inducement)

H4 Range: 1.08420 - 1.08820
M15 BOS at: 1.08650
Inducement: 1.08720
```

This flows through the existing Telegram notification function unchanged since it just reads `reasoning` as a string.

#### Confidence Scoring (New)

Instead of pattern win-rate averages, confidence is based on setup quality:

| Factor | Score |
|--------|-------|
| Weekly rejection present | +15 |
| Daily rejection present | +10 |
| H4 sweep confirmed | +20 (required) |
| M15 BOS confirmed | +20 (required) |
| M15 Inducement found | +10 |
| Rejection at key S/R level | +10 |
| Base | 40 |
| **Max possible** | **~85%** |

Minimum to generate signal: H4 sweep + M15 BOS = 80 base (40 + 20 + 20), which always passes the 50% threshold.

#### API Credit Consideration

Each symbol scan now needs 3 timeframes (1d, 4h, 15min) instead of just 1h. However:
- `fetch-forex-data` has built-in cache freshness checks (skips API call if data is recent)
- Daily data only needs refreshing every ~2 hours
- H4 data every ~30 min, M15 every ~2 min
- Most invocations will hit cache, not the API

## Files Modified

| File | Action |
|------|--------|
| `supabase/functions/scan-opportunities/index.ts` | Replace analysis logic with CRT + MSNR |

## Files NOT Modified (per requirement)

- `supabase/functions/fetch-forex-data/index.ts` (unchanged)
- `supabase/functions/send-telegram-notification/index.ts` (unchanged)
- Database schema / migrations (unchanged)
- All UI components (unchanged)

## Risk Considerations

1. **API credit burn**: 3x more timeframes per scan. Mitigated by fetch-forex-data's cache freshness logic.
2. **Signal frequency**: CRT + MSNR is more selective than mean-reversion. Expect fewer but higher-quality signals.
3. **Weekly data**: Aggregated from daily candles (Twelve Data free tier may not support "1week" interval directly). 5+ daily candles needed for 1 weekly candle.
4. **Edge function timeout**: Multiple fetch-forex-data invocations per symbol. The function will process symbols sequentially, each with 3 sub-calls. For 12 pairs = 36 potential fetch invocations, but most will be cache hits.

