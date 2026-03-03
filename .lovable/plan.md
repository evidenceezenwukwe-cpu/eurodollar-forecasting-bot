

# Fix Signal Pipeline + Data Reset

## Issues Found

1. **Status constraint blocks evaluation (CRITICAL)**: `trading_opportunities_status_check` only allows `ACTIVE`, `EXPIRED`, `TRIGGERED`. The `evaluate-opportunities` function tries to set `COMPLETED` and `CLOSED`, causing a constraint violation on every evaluation — so no WIN/LOSS outcomes are ever recorded, and no outcome Telegram notifications are sent.

2. **Telegram signal notification silently fails**: In `scan-opportunities/index.ts` line 801, the `fetch()` response body is never consumed. In Deno edge runtime, this can cause the request to hang or silently fail. The `notification_sent_at` is also never updated after sending.

3. **API credit exhaustion**: The `15min` cache freshness is only 110 seconds, causing excessive API calls. With 12 pairs × 3 timeframes, credits burn out fast.

4. **Data reset needed**: 1,203 old trading_opportunities, 3 predictions, and 618 prediction_learnings need to be cleared for the fresh start.

## Fixes

### Fix 1: Database Migration — Update Status Constraint
```sql
ALTER TABLE trading_opportunities DROP CONSTRAINT trading_opportunities_status_check;
ALTER TABLE trading_opportunities ADD CONSTRAINT trading_opportunities_status_check 
  CHECK (status IN ('ACTIVE', 'EXPIRED', 'TRIGGERED', 'COMPLETED', 'CLOSED'));
```

### Fix 2: `scan-opportunities/index.ts` — Fix Telegram Call (lines 801-823)
- Consume the response body with `await resp.text()`
- Log the response status
- Update `notification_sent_at` on success

### Fix 3: `fetch-forex-data/index.ts` — Increase 15min Cache Freshness (line 116)
Change `"15min": 110_000` to `"15min": 240_000` (4 minutes instead of ~2 minutes)

### Fix 4: Data Reset — Delete Historical Records
Using the insert tool:
```sql
DELETE FROM prediction_learnings;
DELETE FROM trading_opportunities;
DELETE FROM predictions;
```

## Files Modified
| File | Change |
|------|--------|
| Database migration | Add COMPLETED/CLOSED to status constraint |
| `supabase/functions/scan-opportunities/index.ts` | Consume Telegram response, update notification_sent_at |
| `supabase/functions/fetch-forex-data/index.ts` | 15min cache freshness → 240s |
| Database (data delete) | Clear predictions, prediction_learnings, trading_opportunities |

