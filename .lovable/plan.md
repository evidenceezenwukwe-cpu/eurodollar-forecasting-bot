

# Fix Plan: Stop Loss Buffer, Outcome Notifications, Daily Report

## Issue 1: Stop Losses Too Tight

**Root cause**: In `scan-opportunities/index.ts`, the SL is set to exactly the M15 sweep candle wick (line 450 for SELL: `sweepCandle.high`, line 518 for BUY: `sweepCandle.low`). The entry is the body edge of the same candle. This means the SL distance is just the wick length of a single M15 candle — often only 2-5 pips, far too tight for any trade to breathe.

**Fix**: Add a pip-based buffer beyond the wick. For each symbol, add `bufferPips * pipValue` beyond the wick:
- SELL SL: `sweepCandle.high + (5 * pipValue)` (5 pips above the wick)
- BUY SL: `sweepCandle.low - (5 * pipValue)` (5 pips below the wick)

This gives the trade room to breathe while still being structurally anchored. The buffer accounts for spread + minor noise.

**Files**: `supabase/functions/scan-opportunities/index.ts` (lines 448-451 and 516-518 only)

---

## Issue 2: Outcome Results Not Sent to Telegram

**Root cause**: The `evaluate-opportunities` function queries `price_history` with `timeframe = '1h'` (line 300), but no function ever caches 1h data. The scan function only caches `1d`, `4h`, and `15min`. So `priceHistory` is always empty, the function logs "No price history for opportunity" and skips every evaluation. No outcomes are ever determined, so no outcome notifications are ever sent.

**Fix**: Change the price_history query in `evaluate-opportunities/index.ts` from `timeframe = '1h'` to `timeframe = '15min'` (line 300). The 15min data is cached by the scan function and provides more granular SL/TP hit detection.

**Files**: `supabase/functions/evaluate-opportunities/index.ts` (line 300 only)

---

## Issue 3: Daily Performance Report at 23:00 UTC

**What**: Create a new edge function `send-daily-report` that queries all opportunities resolved that day, tallies WINs, LOSSEs, and EXPIREDs, and sends a summary message to the Telegram group.

**Implementation**:
- New file: `supabase/functions/send-daily-report/index.ts`
- Query `trading_opportunities` where `evaluated_at` is today and `outcome` is not null
- Calculate: total signals, wins, losses, expired, win rate, total pips gained/lost
- Format and send a Telegram message via the existing `send-telegram-notification` function (or directly via Telegram API since the report format is unique)
- Add to `supabase/config.toml` with `verify_jwt = false`
- This function would be triggered by a cron job at 23:00 UTC daily

**Files**:
- `supabase/functions/send-daily-report/index.ts` (new)
- `supabase/config.toml` (add function config)

---

## Summary of Changes

| File | Change |
|------|--------|
| `scan-opportunities/index.ts` | Add 5-pip buffer to SL beyond M15 wick (lines 450, 518) |
| `evaluate-opportunities/index.ts` | Change price_history query from `'1h'` to `'15min'` (line 300) |
| `send-daily-report/index.ts` | New function: daily W/L summary to Telegram at 23:00 |
| `supabase/config.toml` | Register `send-daily-report` |

